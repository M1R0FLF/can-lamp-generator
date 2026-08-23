import { FieldCtx } from '../fieldkit';
import { StippleParams } from '../stipple';

export type PresetGroup = 'nature' | 'tech' | 'art' | 'cosmic' | 'urban';

export interface Preset {
  id: string;
  name: string;
  group: PresetGroup;
  description: string;
  /**
   * Stipple parameters tuned for this design. The reference presets' numbers
   * were arrived at by visual iteration and are the specification — see
   * CLAUDE.md. Quality presets in the UI override pitch/diameters; mode,
   * gamma, knee and thresh stay with the design.
   */
  stipple: Partial<StippleParams>;
  build(ctx: FieldCtx): Float32Array;
}
