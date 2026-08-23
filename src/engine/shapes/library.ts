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

export function getShapeDef(id: string): ShapeDef | undefined {
  return SHAPE_BY_ID[id];
}
