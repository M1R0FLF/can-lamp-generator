// The user-facing catalogue of dot patterns.
//
// stipple.ts exposes `dither` as an axis independent of `mode` because that is
// what keeps the reference presets bit-identical. This file is the other half
// of that decision: `dither` is not something to put in front of a user as a
// dropdown of algorithm names, so the UI offers three named looks and this
// table is the mapping.
//
// Every entry earned its place by measurement. Two numbers separate them:
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
//
// Note the open-area column: all three are identical, so switching pattern
// changes the grain and not the exposure — no re-tuning the tone sliders after
// a switch. That comes free here because all three share the hex lattice; it
// was NOT free for the off-grid pattern that was tried and dropped, and
// CLAUDE.md rule 10 records why that matters.
//
// Two further candidates were built and measured out of the product rather
// than into it: a "linearised tone" option (0.15% different from what the
// existing hard-coded gamma already does — tools/measure/response.ts) and an
// off-grid Organic pattern. Rule 10 has both.
import { DitherKind } from './stipple';

export interface Generator {
  id: string;
  name: string;
  /** one line, shown under the picker */
  hint: string;
  dither: DitherKind;
}

export const GENERATORS: Generator[] = [
  {
    id: 'classic',
    name: 'Classic',
    hint:
      'The original pattern, and what every preset was tuned against. ' +
      'Slight diagonal grain in flat mid-tones.',
    dither: 'hash',
  },
  {
    id: 'smooth',
    name: 'Smooth',
    hint:
      'Cleanest flat tones and gradients — no grain at all — at the cost of ' +
      'a little fine detail. Best for skies, skin, big soft shapes.',
    dither: 'blue',
  },
  {
    id: 'detail',
    name: 'Detail',
    hint:
      'Sharpest of the three: holds about 13% more contrast in ~4mm features, ' +
      'so eyes, lettering and thin lines survive. Best for photos.',
    dither: 'diffusion',
  },
];

export const DEFAULT_GENERATOR_ID = 'classic';

export function getGenerator(id: string): Generator {
  return GENERATORS.find((g) => g.id === id) ?? GENERATORS[0];
}
