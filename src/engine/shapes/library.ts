// The single stamp catalogue the composer draws from, assembled from the two
// authored halves. Both halves declare the same ShapeDef shape, so they merge
// structurally; this module is the one place the rest of the app imports from.
import { LIBRARY_BASIC, ShapeDef, ShapeCategory } from './libraryBasic';
import { LIBRARY_MOTIFS } from './libraryMotifs';

export type { ShapeDef, ShapeCategory };

export const SHAPE_LIBRARY: ShapeDef[] = [...LIBRARY_BASIC, ...LIBRARY_MOTIFS];

export const SHAPE_BY_ID: Record<string, ShapeDef> = Object.fromEntries(
  SHAPE_LIBRARY.map((s) => [s.id, s])
);

export interface CategoryDef {
  id: ShapeCategory;
  name: string;
}

export const SHAPE_CATEGORIES: CategoryDef[] = [
  { id: 'basic', name: 'Basic' },
  { id: 'geometric', name: 'Geometric' },
  { id: 'nature', name: 'Nature' },
  { id: 'celestial', name: 'Sky' },
  { id: 'tech', name: 'Tech' },
  { id: 'decor', name: 'Borders' },
];

export function shapesInCategory(cat: ShapeCategory): ShapeDef[] {
  return SHAPE_LIBRARY.filter((s) => s.category === cat);
}

/**
 * The "Simple" palette: the stamps that survive rule 3 most reliably.
 *
 * Every one of these is a chunky CLOSED form whose silhouette is still legible
 * at a 1.2-1.45mm pitch from across a room. The library's finer entries (fern
 * frond, comet, wifi, spiral, corner frame) are not worse shapes — they just
 * ask more of the person placing them, because they need to be sized up and
 * given dark space before they read, and a first-time user has no reason to
 * know that yet. They stay one click away under "All shapes".
 *
 * An explicit ordered ID list rather than a `simple: true` flag on 20 of the
 * 56 defs, for two reasons: it keeps the choice reviewable in one place instead
 * of scattered across two 500+ line authored files, and it fixes the palette
 * ORDER independently of the category grouping — so the Simple view reads
 * primitives, then geometry, then subjects, then bands.
 *
 * The spread is deliberate: five neutral primitives, four geometric, five
 * natural subjects, three sky, one machine and two framing bands. That is
 * enough to build a whole can without ever opening the full library.
 */
export const SIMPLE_SHAPE_IDS: readonly string[] = [
  // primitives
  'circle', 'ring', 'square', 'triangle', 'diamond',
  // geometric
  'hexagon', 'star-5', 'star-6', 'rings-3',
  // nature
  'leaf', 'monstera-leaf', 'flower', 'pine-tree', 'butterfly',
  // sky
  'sun', 'crescent-moon', 'full-moon',
  // machine
  'gear',
  // full-width bands, for framing top and bottom
  'band-solid', 'band-dots',
];

/** The Simple palette, in the curated order above. */
export function simpleShapes(): ShapeDef[] {
  return SIMPLE_SHAPE_IDS.map((id) => SHAPE_BY_ID[id]).filter(Boolean);
}


export function getShapeDef(id: string): ShapeDef | undefined {
  return SHAPE_BY_ID[id];
}
