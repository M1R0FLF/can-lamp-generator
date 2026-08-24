// The user-facing catalogue of dot patterns.
//
// stipple.ts exposes `grid` and `dither` as independent axes because that is
// what keeps the reference presets bit-identical. This file is the other half
// of that decision: the axes are not something to put in front of a user as
// two dropdowns, because most of the six combinations are not worth choosing
// between and one of them (organic + diffusion) is not even implementable —
// error diffusion needs a scan order that an unstructured point set does not
// have. So the UI offers four named looks and this table is the mapping.
//
// Every entry earned its place by measurement, and one candidate did not make
// it: a "linearised tone" option, which measured out at 0.15% different from
// what the existing hard-coded gamma already does (see tools/measure/
// response.ts). Two numbers decide between the four that remain:
//
//   MTF@48c  - how much contrast survives at ~4mm features, which is the
//              scale of an eye in a portrait. 1.0 = nothing lost.
//   chaining - concentration of nearest-neighbour directions at mid-tone.
//              0 = isotropic; high means the dots fall into lines, which on a
//              backlit can reads as faint scratches across a smooth gradient.
//
//              MTF@48c   chaining   open area
//   Classic     0.796      0.378      11.67%
//   Smooth      0.785      0.013      11.67%
//   Detail      0.897      0.153      11.67%
//   Organic     0.814      0.006      11.68%
//
// Note the open-area column: all four land within 0.01 percentage points, so
// switching pattern changes the grain and not the exposure. That is not luck —
// `organicPacking` in stipple.ts is calibrated to make it true, because
// otherwise this picker would double as a brightness control and every switch
// would need the tone sliders re-tuned.
import { DitherKind, GridKind } from './stipple';

export interface Generator {
  id: string;
  name: string;
  /** one line, shown under the picker */
  hint: string;
  grid: GridKind;
  dither: DitherKind;
}

export const GENERATORS: Generator[] = [
  {
    id: 'classic',
    name: 'Classic',
    hint:
      'The original pattern, and what every preset was tuned against. ' +
      'Slight diagonal grain in flat mid-tones.',
    grid: 'hex',
    dither: 'hash',
  },
  {
    id: 'smooth',
    name: 'Smooth',
    hint:
      'Blue-noise dots. Cleanest flat tones and gradients — no grain — ' +
      'at the cost of a little fine detail. Best for skies, skin, big soft shapes.',
    grid: 'hex',
    dither: 'blue',
  },
  {
    id: 'detail',
    name: 'Detail',
    hint:
      'Error diffusion. Holds about 13% more contrast in ~4mm features, so ' +
      'eyes, lettering and thin lines survive. Best for photos.',
    grid: 'hex',
    dither: 'diffusion',
  },
  {
    id: 'organic',
    name: 'Organic',
    hint:
      'Off-grid dots at a guaranteed spacing. Hand-stippled look, cannot ' +
      'moiré against stripes or brickwork, and leaves the widest metal webs.',
    grid: 'organic',
    dither: 'blue',
  },
];

export const DEFAULT_GENERATOR_ID = 'classic';

export function getGenerator(id: string): Generator {
  return GENERATORS.find((g) => g.id === id) ?? GENERATORS[0];
}
