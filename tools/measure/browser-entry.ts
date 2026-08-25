// Harness entry: exposes the engine on `window.LAMP` so the Node driver in
// `run.mjs` can call it inside a real Chromium.
//
// The engine is not portable to bare Node: FieldCtx and photo.ts both build
// fields through an actual Canvas2D (that is the whole point of the port plan
// in CLAUDE.md — Canvas rasterizes in C instead of shipping numpy). So a
// faithful measurement has to run in a browser. Chromium is preinstalled, so
// this costs nothing.
import * as generate from '../../src/engine/generate';
import * as stipple from '../../src/engine/stipple';
import * as photo from '../../src/engine/photo';
import * as portrait from '../../src/engine/portrait';
import * as fieldkit from '../../src/engine/fieldkit';
import * as minweb from '../../src/engine/minweb';
import * as glow from '../../src/engine/glow';
import * as presets from '../../src/engine/presets';
import * as quality from '../../src/engine/qualityPresets';
import * as response from './response';
import * as bluenoise from '../../src/engine/bluenoise';

(globalThis as any).LAMP = {
  ...generate,
  ...stipple,
  ...photo,
  ...portrait,
  ...fieldkit,
  ...minweb,
  ...glow,
  ...presets,
  ...quality,
  ...response,
  ...bluenoise,
};
