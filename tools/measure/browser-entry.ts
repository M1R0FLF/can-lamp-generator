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
import * as faceFind from '../../src/engine/faceFind';
import * as fieldkit from '../../src/engine/fieldkit';
import * as minweb from '../../src/engine/minweb';
import * as glow from '../../src/engine/glow';
import * as presets from '../../src/engine/presets';
import * as quality from '../../src/engine/qualityPresets';
import * as response from './response';
import * as bluenoise from '../../src/engine/bluenoise';
import * as rng from '../../src/engine/rng';
// The shape library, so a measurement can compose a custom scene the way
// the UI's editor does instead of hardcoding one.
import * as shapes from '../../src/engine/shapes/library';
import * as customShapes from '../../src/engine/customShapes';

(globalThis as any).LAMP = {
  ...generate,
  ...stipple,
  ...photo,
  ...portrait,
  ...faceFind,
  ...fieldkit,
  ...minweb,
  ...glow,
  ...presets,
  ...quality,
  ...response,
  ...bluenoise,
  ...rng,
  ...shapes,
  ...customShapes,
};
