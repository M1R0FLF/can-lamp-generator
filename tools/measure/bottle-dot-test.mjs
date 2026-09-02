#!/usr/bin/env node
// The dot half of the glass calibration, as vector SVG.
//
//   node tools/measure/bottle-dot-test.mjs out.svg [diameter] [panelHeight]
//
// bottle-tile.mjs answers five questions at once and covers a lot of the wall
// doing it. After a bottle let go during a grid test, that is the wrong first
// job: heat is cumulative and area is what costs. This is the subset that
// actually decides whether a stipple can exist on glass at all — pitch against
// dot diameter — laid out sparse, with most of the wrap left bare so the glass
// has somewhere to dump heat between patches.
//
// WHY A MATRIX RATHER THAN TWO LADDERS. On aluminium the two are separable:
// hole diameter sets tone and pitch sets the web, and rule 2 relates them by a
// simple inequality. On glass they interact through a mechanism the can never
// had — the CO2 spot is 0.15 x 0.2mm on a P2S, so a "0.15mm dot" is one spot
// and a "0.4mm dot" is a short overlapped track, and the amount of heat each
// dumps into its neighbourhood differs by more than its area does. Merging is
// therefore a function of both axes at once, and a matrix is the honest shape.
//
// Cells where diameter >= pitch are skipped rather than drawn: they are not a
// stipple, they are a solid fill with extra steps.
//
// RUN IT AS A FILL, NEVER AS A LINE/SCORE OPERATION. Every dot here is a closed
// path. In fill mode the software rasterises them and this is a few minutes; in
// line mode it traces ~10,000 tiny circle outlines, which on a gantry is hours
// of accel/decel — and, far worse on glass, a scored outline is the first half
// of a glass-cutting operation. Laser glass cutting works by scribing and then
// separating along the scribe with thermal shock, so a traced line on a 2.5-3mm
// bottle wall does not cut it, it installs a crack path and waits.
import fs from 'node:fs/promises';

const [outPath = 'bottle-dot-test.svg', dArg = '60.9', hArg = '84'] = process.argv.slice(2);
const D = Number(dArg);
const H = Number(hArg);
const W = Math.PI * D;

// Down the rows. Starts at 0.4 because the P2S spot is 0.15 x 0.2mm and the
// documented merge floor is about 2x the spot; 0.4 is meant to be the rung that
// fails, so the first one that passes is bracketed rather than assumed.
const PITCHES = [0.4, 0.5, 0.6, 0.8, 1.0, 1.2];
// Across the columns. 0.15 is one spot: the machine cannot render smaller, only
// fainter, so this column tests "does a single-spot dot mark at all", which is
// the glass analogue of the can tile's smallest-hole-that-penetrates.
const DIAMS = [0.15, 0.2, 0.25, 0.3, 0.4];

const PATCH_W = 20;
const PATCH_H = 7;
const GAP_X = 6;
const GAP_Y = 3.5;
const MARGIN_TOP = 5;
const DOSE_GAP = 5.5; // clear band between the matrix and the dose strip

const gridW = DIAMS.length * PATCH_W + (DIAMS.length - 1) * GAP_X;
const gridH = PITCHES.length * PATCH_H + (PITCHES.length - 1) * GAP_Y;
// Centred in x, so the bare glass either side is symmetric and the seam at
// x=0/W stays clear of any patch — the wrap has to close on unmarked glass.
// Top-anchored in y, because the dose strip has to sit below the matrix and a
// centred grid leaves it nowhere to go.
const X0 = (W - gridW) / 2;
const Y0 = MARGIN_TOP;
const DOSE_Y = Y0 + gridH + DOSE_GAP;

// The first version centred the matrix vertically and then put the dose strip
// at a hardcoded H-12, which silently overlapped the bottom row: two different
// dose settings landing on the same glass, i.e. exactly the confound the strip
// exists to avoid. Cheap to assert, and it only fails at generation time.
if (DOSE_Y + PATCH_H > H - 2) {
  throw new Error(
    `layout does not fit: dose strip ends at ${(DOSE_Y + PATCH_H).toFixed(1)}mm on an ${H}mm panel. ` +
      'Reduce PATCH_H/GAP_Y, drop a pitch row, or pass a taller panel.'
  );
}

const dots = [];
const skipped = [];
for (let r = 0; r < PITCHES.length; r++) {
  const pitch = PITCHES[r];
  const rowH = (pitch * Math.sqrt(3)) / 2;
  for (let c = 0; c < DIAMS.length; c++) {
    const d = DIAMS[c];
    if (d >= pitch) {
      skipped.push(`p${pitch}/Ø${d}`);
      continue;
    }
    const px = X0 + c * (PATCH_W + GAP_X);
    const py = Y0 + r * (PATCH_H + GAP_Y);
    for (let j = 0; (j + 0.5) * rowH < PATCH_H; j++) {
      for (let i = 0; (i + 0.5 + (j % 2 ? 0.5 : 0)) * pitch < PATCH_W; i++) {
        dots.push({
          x: px + (i + 0.5 + (j % 2 ? 0.5 : 0)) * pitch,
          y: py + (j + 0.5) * rowH,
          r: d / 2,
        });
      }
    }
  }
}

// A dose strip, in its own colours so each patch becomes its own layer and can
// take its own power/speed. Geometry is held FIXED across it at a mid tuple, so
// the strip varies dose and only dose — the matrix above varies geometry at one
// dose, and confounding the two is how a grid test stops being a measurement.
// Four patches is what fits without eating the margins the heat budget needs.
const DOSE_COLOURS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231'];
const doseGroups = [];
{
  const pitch = 1.0;
  const d = 0.3;
  const rowH = (pitch * Math.sqrt(3)) / 2;
  const stripW = DOSE_COLOURS.length * PATCH_W + (DOSE_COLOURS.length - 1) * GAP_X;
  const sx = (W - stripW) / 2;
  const sy = DOSE_Y;
  DOSE_COLOURS.forEach((col, k) => {
    const px = sx + k * (PATCH_W + GAP_X);
    const out = [];
    for (let j = 0; (j + 0.5) * rowH < PATCH_H; j++) {
      for (let i = 0; (i + 0.5 + (j % 2 ? 0.5 : 0)) * pitch < PATCH_W; i++) {
        out.push({
          x: px + (i + 0.5 + (j % 2 ? 0.5 : 0)) * pitch,
          y: sy + (j + 0.5) * rowH,
          r: d / 2,
        });
      }
    }
    doseGroups.push({ colour: col, dots: out });
  });
}

const circle = (h) => `<circle cx="${h.x.toFixed(3)}" cy="${h.y.toFixed(3)}" r="${h.r.toFixed(4)}"/>`;

// Orientation: one solid square near the seam, top-left. Wrapped round a
// cylinder a symmetric grid is ambiguous end-for-end and the row order becomes
// unreadable, which would make every answer here unattributable.
const orient = `<rect x="4" y="${(MARGIN_TOP - 3).toFixed(1)}" width="4" height="3"/>`;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Glass dot test - Ø${D} x ${H}mm bottle, ${W.toFixed(1)}mm wrap.
     RUN AS FILL, NOT LINE/SCORE. A traced circle outline on 2.5-3mm bottle
     glass is a scribe, and a scribe plus a thermal gradient is how glass is
     deliberately cut. Fill rasterises instead, which is both faster and safer.
     ONE PASS. Repeated passes over the same geometry drive cracks.

     Layers by colour:
       #000000  the pitch x diameter matrix. One setting for the whole matrix -
                it is the geometry test and its dose must be constant.
       ${DOSE_COLOURS.join('  ')}
                the dose strip, fixed geometry (1.0mm pitch, Ø0.3mm), four
                separate settings. Assign increasing power, lowest first.

     Rows top to bottom, pitch: ${PITCHES.join(' ')} mm
     Cols left to right, dot Ø: ${DIAMS.join(' ')} mm
     ${skipped.length ? `Blank cells (Ø >= pitch, not a stipple): ${skipped.join(' ')}` : ''}
-->
<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(3)}mm" height="${H.toFixed(3)}mm" viewBox="0 0 ${W.toFixed(3)} ${H.toFixed(3)}">
<title>Glass dot test — Ø${D} × ${H}mm</title>
<g id="matrix" fill="#000000" stroke="none">
${orient}
${dots.map(circle).join('\n')}
</g>
${doseGroups
  .map(
    (g, k) =>
      `<g id="dose-${k + 1}" fill="${g.colour}" stroke="none">\n${g.dots.map(circle).join('\n')}\n</g>`
  )
  .join('\n')}
</svg>
`;

await fs.writeFile(outPath, svg);

const doseCount = doseGroups.reduce((n, g) => n + g.dots.length, 0);
console.log(`wrote ${outPath}`);
console.log(`canvas ${W.toFixed(1)} x ${H}mm (Ø${D} bottle)`);
console.log(`matrix ${DIAMS.length} cols x ${PITCHES.length} rows, ${dots.length} dots`);
console.log(`dose strip ${DOSE_COLOURS.length} patches, ${doseCount} dots`);
const markedMm2 =
  dots.reduce((a, h) => a + Math.PI * h.r * h.r, 0) +
  doseGroups.reduce((a, g) => a + g.dots.reduce((b, h) => b + Math.PI * h.r * h.r, 0), 0);
// Marked fraction is the heat budget in one number: it is what separates this
// from the full tile, and from the grid test that took a bottle apart.
console.log(
  `total ${dots.length + doseCount} dots, marked area ${((markedMm2 / (W * H)) * 100).toFixed(2)}% of the wrap`
);
console.log(`ROWS  top->bottom, pitch mm: ${PITCHES.join('  ')}`);
console.log(`COLS  left->right, dot Ø mm: ${DIAMS.join('  ')}`);
if (skipped.length) console.log(`BLANK cells (Ø >= pitch): ${skipped.join('  ')}`);
console.log(`
Orientation square is TOP-LEFT (4mm in from the seam). Largest pitch is the
BOTTOM row of the matrix; the four-colour strip below it is the dose ladder.

HOW TO RUN
  * FILL mode, one pass. Not line, not score - see the note in the file.
  * Black matrix: one setting, the lowest you think will mark. 55W P2S on bare
    glass, the documented starting point is 10-15% power at 300mm/s.
  * Colour strip: four settings, lowest first, stepping up from the matrix's.
    Stop stepping up the moment a patch chips rather than frosts.
  * Air assist low or off. Room-temperature bottle. Lid closed.

HOW TO READ
  Matrix: the leftmost column and topmost row that still show SEPARATE dots give
  you dMin and the minimum pitch. Everything above and left of that boundary is
  where a stipple cannot live on this machine.
  Dose strip: the brightest patch that is still frost and not chipping is your
  working dose. Read it backlit as well as in ambient - the two disagree.
`);
