// "Make your own" composer model.
//
// A placed shape is a reference into the stamp library plus a transform.
// Position is stored as a FRACTION of circumference/height, never mm — per
// CLAUDE.md rule 1, that is what survives a diameter change unscathed.
import { FieldCtx, clamp01 } from './fieldkit';
import { getShapeDef } from './shapes/library';

export interface CustomShape {
  id: string;
  /** ShapeDef.id in the stamp library */
  shapeId: string;
  /** fraction of circumference, 0..1 (ignored by full-width shapes) */
  xFrac: number;
  /** fraction of height, 0..1 */
  yFrac: number;
  /** nominal radius / half-extent, mm */
  size: number;
  /** degrees */
  rotation: number;
}

let counter = 0;
export function newShapeId(): string {
  counter += 1;
  return `s${counter.toString(36)}${Math.floor(performance.now()).toString(36)}`;
}

export function makeShape(shapeId: string, xFrac: number, yFrac: number): CustomShape {
  const def = getShapeDef(shapeId);
  return {
    id: newShapeId(),
    shapeId,
    xFrac,
    yFrac,
    size: def?.defaultSizeMm ?? 12,
    rotation: 0,
  };
}

export function isFullWidth(s: CustomShape): boolean {
  return getShapeDef(s.shapeId)?.fullWidth === true;
}

export function canRotate(s: CustomShape): boolean {
  const def = getShapeDef(s.shapeId);
  return !(def?.noRotate || def?.fullWidth);
}

// ---------- field building ----------

export function buildCustomField(ctx: FieldCtx, shapes: CustomShape[]): Float32Array {
  if (shapes.length === 0) return ctx.blank(0);
  const mask = ctx.mask((d) => {
    for (const s of shapes) {
      const def = getShapeDef(s.shapeId);
      if (!def) continue;
      def.draw(d, s.xFrac * ctx.W, s.yFrac * ctx.H, s.size, s.rotation);
    }
  });
  // rule 4 — every placed form gets figure/ground separation for free, so a
  // composition reads without the user having to know that trick
  return clamp01(ctx.moat(ctx.blank(0), mask, 2.6, 1.0));
}

export const CUSTOM_STIPPLE = {
  mode: 'hybrid' as const,
  pitchMm: 1.35,
  dMin: 0.26,
  dMax: 0.5,
  jitter: 0.13,
  thresh: 0.05,
  knee: 0.45,
  gamma: 0.75,
};

/** A small starter scene so the canvas isn't a blank void on first use. */
export function starterShapes(): CustomShape[] {
  return [
    { id: newShapeId(), shapeId: 'band-fret', xFrac: 0, yFrac: 0.05, size: 5, rotation: 0 },
    { id: newShapeId(), shapeId: 'band-fret', xFrac: 0, yFrac: 0.95, size: 5, rotation: 0 },
    { id: newShapeId(), shapeId: 'sun', xFrac: 0.22, yFrac: 0.66, size: 17, rotation: 0 },
    { id: newShapeId(), shapeId: 'pine-tree', xFrac: 0.52, yFrac: 0.34, size: 15, rotation: 0 },
    { id: newShapeId(), shapeId: 'crescent-moon', xFrac: 0.8, yFrac: 0.68, size: 12, rotation: 20 },
  ];
}

// ---------- editing operations ----------
//
// All of these take the full shape list plus the set of selected ids and
// return a NEW list, so the caller can treat state as immutable-ish.

type Sel = Set<string>;

function partition(shapes: CustomShape[], sel: Sel) {
  const picked = shapes.filter((s) => sel.has(s.id));
  return { picked };
}

/** Shortest signed delta between two fractions on a wrapping axis. */
function wrapDelta(a: number, b: number): number {
  let d = b - a;
  d = ((d % 1) + 1) % 1;
  if (d > 0.5) d -= 1;
  return d;
}

/**
 * Mean x of a selection on a circular axis. A plain average is wrong when a
 * group straddles the seam (0.95 and 0.05 would average to 0.5, the far side
 * of the can), so this averages as unit vectors instead.
 */
export function circularMeanX(shapes: CustomShape[]): number {
  if (!shapes.length) return 0.5;
  let sx = 0;
  let sy = 0;
  for (const s of shapes) {
    const a = s.xFrac * Math.PI * 2;
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return shapes[0].xFrac;
  const ang = Math.atan2(sy, sx);
  return ((ang / (Math.PI * 2)) % 1 + 1) % 1;
}

export type AlignMode = 'left' | 'centerX' | 'right' | 'top' | 'middleY' | 'bottom';

export function alignShapes(shapes: CustomShape[], sel: Sel, mode: AlignMode): CustomShape[] {
  const { picked } = partition(shapes, sel);
  if (picked.length < 2) return shapes;

  if (mode === 'centerX') {
    const cx = circularMeanX(picked);
    return shapes.map((s) => (sel.has(s.id) ? { ...s, xFrac: cx } : s));
  }
  if (mode === 'left' || mode === 'right') {
    // "left"/"right" are relative to the selection's own centre, since a
    // wrapping axis has no absolute left or right edge
    const cx = circularMeanX(picked);
    const edge = picked.reduce((best, s) => {
      const d = wrapDelta(cx, s.xFrac);
      return mode === 'left' ? Math.min(best, d) : Math.max(best, d);
    }, mode === 'left' ? Infinity : -Infinity);
    const target = ((cx + edge) % 1 + 1) % 1;
    return shapes.map((s) => (sel.has(s.id) ? { ...s, xFrac: target } : s));
  }

  const ys = picked.map((s) => s.yFrac);
  const target =
    mode === 'top' ? Math.max(...ys) : mode === 'bottom' ? Math.min(...ys) : ys.reduce((a, b) => a + b, 0) / ys.length;
  return shapes.map((s) => (sel.has(s.id) ? { ...s, yFrac: target } : s));
}

/** Even angular spacing around the full circumference. */
export function distributeAround(shapes: CustomShape[], sel: Sel): CustomShape[] {
  const { picked } = partition(shapes, sel);
  if (picked.length < 2) return shapes;
  const ordered = [...picked].sort((a, b) => a.xFrac - b.xFrac);
  const start = ordered[0].xFrac;
  const step = 1 / ordered.length;
  const nextX = new Map<string, number>();
  ordered.forEach((s, i) => nextX.set(s.id, ((start + i * step) % 1 + 1) % 1));
  return shapes.map((s) => (nextX.has(s.id) ? { ...s, xFrac: nextX.get(s.id)! } : s));
}

/** Even vertical spacing between the selection's existing extremes. */
export function distributeVertical(shapes: CustomShape[], sel: Sel): CustomShape[] {
  const { picked } = partition(shapes, sel);
  if (picked.length < 3) return shapes;
  const ordered = [...picked].sort((a, b) => a.yFrac - b.yFrac);
  const lo = ordered[0].yFrac;
  const hi = ordered[ordered.length - 1].yFrac;
  const step = (hi - lo) / (ordered.length - 1);
  const nextY = new Map<string, number>();
  ordered.forEach((s, i) => nextY.set(s.id, lo + i * step));
  return shapes.map((s) => (nextY.has(s.id) ? { ...s, yFrac: nextY.get(s.id)! } : s));
}

/** Reflect the selection about its own centre, horizontally or vertically. */
export function mirrorShapes(shapes: CustomShape[], sel: Sel, axis: 'h' | 'v'): CustomShape[] {
  const { picked } = partition(shapes, sel);
  if (!picked.length) return shapes;

  if (axis === 'h') {
    const cx = circularMeanX(picked);
    return shapes.map((s) => {
      if (!sel.has(s.id)) return s;
      const d = wrapDelta(cx, s.xFrac);
      return { ...s, xFrac: ((cx - d) % 1 + 1) % 1, rotation: (360 - s.rotation) % 360 };
    });
  }
  const ys = picked.map((s) => s.yFrac);
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return shapes.map((s) =>
    sel.has(s.id) ? { ...s, yFrac: cy - (s.yFrac - cy), rotation: (180 - s.rotation + 360) % 360 } : s
  );
}

/** Copy the selection, nudged so the duplicates are visible and selectable. */
export function duplicateShapes(
  shapes: CustomShape[],
  sel: Sel
): { shapes: CustomShape[]; newIds: string[] } {
  const { picked } = partition(shapes, sel);
  if (!picked.length) return { shapes, newIds: [] };
  const copies = picked.map((s) => ({
    ...s,
    id: newShapeId(),
    xFrac: ((s.xFrac + 0.04) % 1 + 1) % 1,
    yFrac: Math.min(0.97, Math.max(0.03, s.yFrac - 0.03)),
  }));
  return { shapes: [...shapes, ...copies], newIds: copies.map((c) => c.id) };
}

/**
 * Repeat the selection evenly around the whole circumference. The natural
 * move on a cylinder — one stamp becomes a band of stamps that closes on
 * itself, because the copies are placed at exact 1/n fractions.
 */
export function ringArray(
  shapes: CustomShape[],
  sel: Sel,
  count: number
): { shapes: CustomShape[]; newIds: string[] } {
  const { picked } = partition(shapes, sel);
  if (!picked.length || count < 2) return { shapes, newIds: [] };
  const copies: CustomShape[] = [];
  for (const s of picked) {
    for (let k = 1; k < count; k++) {
      copies.push({ ...s, id: newShapeId(), xFrac: ((s.xFrac + k / count) % 1 + 1) % 1 });
    }
  }
  return { shapes: [...shapes, ...copies], newIds: copies.map((c) => c.id) };
}

export function nudgeShapes(
  shapes: CustomShape[],
  sel: Sel,
  dxFrac: number,
  dyFrac: number
): CustomShape[] {
  return shapes.map((s) =>
    sel.has(s.id)
      ? {
          ...s,
          xFrac: ((s.xFrac + dxFrac) % 1 + 1) % 1,
          yFrac: Math.min(0.995, Math.max(0.005, s.yFrac + dyFrac)),
        }
      : s
  );
}
