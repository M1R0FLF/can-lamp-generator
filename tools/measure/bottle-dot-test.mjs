#!/usr/bin/env node
// The dot half of the glass calibration, as vector SVG.
//
//   node tools/measure/bottle-dot-test.mjs out.svg [diameter] [panelHeight] [dotMm]
//
// bottle-tile.mjs answers five questions at once and covers a lot of the wall
// doing it. After a bottle let go during a grid test, that is the wrong first
// job: heat is cumulative and marked area is what costs. This is the subset
// that decides whether a stipple can exist on glass at all, laid out sparse —
// about 3% of the wrap marked, the rest left bare so the glass has somewhere
// to dump heat between patches.
//
// ONE DOT SIZE, NOT A SIZE LADDER. The first version was a pitch x diameter
// matrix, on the reasoning that the two axes interact on glass. They do — but
// only if diameter is a controllable axis, and in SCORE mode it is not. A
// scored dot is the beam tracing a closed path barely larger than its own
// spot, so a "0.15mm dot" and a "0.25mm dot" both come out as one 0.15 x 0.2mm
// mark and the ladder measures the plotter, not the glass. Size only becomes
// real in fill mode, where the raster can lay an overlapped track wider than
// the spot. So: pitch is the variable, dot size is a constant, and the constant
// defaults to roughly one spot.
//
// That leaves the ladder one-dimensional, which buys back the width for more
// pitch rungs and much larger patches — both of which make "are these dots
// still separate?" an easier call to make by eye on curved amber glass.
//
// IF YOU SCORE THIS, IT IS THE HIGHER-RISK MODE ON GLASS. Laser glass cutting
// works by scribing a line and separating along it with thermal shock, and a
// 2.5-3mm bottle wall is far too thick to cut, so a traced path does not cut,
// it installs a crack path. That is the most likely explanation for a bottle
// coming apart during a grid test. One pass, lowest power that marks, and stop
// at the first sign of chipping. Fill mode remains the safer way to get the
// same answer, and the file works either way.
import fs from 'node:fs/promises';

const [outPath = 'bottle-dot-test.svg', dArg = '60.9', hArg = '84', dotArg = '0.2'] =
  process.argv.slice(2);
const D = Number(dArg);
const H = Number(hArg);
const DOT = Number(dotArg);
const W = Math.PI * D;

// The only variable. Starts at 0.3 because the P2S spot is 0.15 x 0.2mm and the
// documented merge floor is about 2x the spot; 0.3 is meant to be the rung that
// fails, so the first passing rung is bracketed rather than assumed. Runs out to
// 1.5 because the shipped can ladder lives at 0.98-1.45 and the useful answer is
// not just "what is the floor" but "does the existing tuning clear it".
const PITCHES = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0, 1.2, 1.5];

const MARGIN_X = 8;
const GAP_X = 4;
const LADDER_H = 26;
const DOSE_H = 16;
const BLOCK_GAP = 10;

const PATCH_W = (W - 2 * MARGIN_X - (PITCHES.length - 1) * GAP_X) / PITCHES.length;
// Vertically centred as one block, so the bare bands above and below are equal
// and neither the shoulder nor the heel end of the panel gets the hot edge.
const BLOCK_H = LADDER_H + BLOCK_GAP + DOSE_H;
const LADDER_Y = (H - BLOCK_H) / 2;
const DOSE_Y = LADDER_Y + LADDER_H + BLOCK_GAP;

// The first version centred the ladder and put the dose strip at a hardcoded
// H-12, which silently overlapped it: two different dose settings landing on
// the same glass, i.e. exactly the confound the strip exists to avoid. Caught
// by rendering the SVG and looking at it. Cheap to assert, and it can only fail
// at generation time.
if (DOSE_Y + DOSE_H > H - 2 || LADDER_Y < 2) {
  throw new Error(
    `layout does not fit an ${H}mm panel: ladder ${LADDER_Y.toFixed(1)}mm, ` +
      `dose strip ends ${(DOSE_Y + DOSE_H).toFixed(1)}mm. Reduce LADDER_H/DOSE_H or pass a taller panel.`
  );
}
if (DOT >= PITCHES[0]) {
  throw new Error(`dot Ø${DOT}mm is not smaller than the finest pitch ${PITCHES[0]}mm — that is a fill, not a stipple.`);
}

/** Hex field of dots filling a patch. */
function patch(x0, y0, w, h, pitch, d) {
  const rowH = (pitch * Math.sqrt(3)) / 2;
  const out = [];
  for (let j = 0; (j + 0.5) * rowH < h; j++) {
    for (let i = 0; (i + 0.5 + (j % 2 ? 0.5 : 0)) * pitch < w; i++) {
      out.push({
        x: x0 + (i + 0.5 + (j % 2 ? 0.5 : 0)) * pitch,
        y: y0 + (j + 0.5) * rowH,
        r: d / 2,
      });
    }
  }
  return out;
}

const ladder = [];
PITCHES.forEach((pitch, i) => {
  ladder.push(...patch(MARGIN_X + i * (PATCH_W + GAP_X), LADDER_Y, PATCH_W, LADDER_H, pitch, DOT));
});

// A dose strip, in its own colours so each patch becomes its own layer and can
// take its own power/speed. Geometry is held FIXED across it at a mid pitch, so
// the strip varies dose and only dose — the ladder above varies pitch at one
// dose. Confounding the two is how a grid test stops being a measurement.
const DOSE_COLOURS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231'];
const DOSE_PITCH = 1.0;
const doseGroups = DOSE_COLOURS.map((colour, k) => {
  const stripW = DOSE_COLOURS.length * PATCH_W + (DOSE_COLOURS.length - 1) * GAP_X;
  const sx = (W - stripW) / 2;
  return { colour, dots: patch(sx + k * (PATCH_W + GAP_X), DOSE_Y, PATCH_W, DOSE_H, DOSE_PITCH, DOT) };
});

const circle = (h) => `<circle cx="${h.x.toFixed(3)}" cy="${h.y.toFixed(3)}" r="${h.r.toFixed(4)}"/>`;

// Orientation: one solid square near the seam, top-left. Wrapped round a
// cylinder the ladder is ambiguous end-for-end, and reading it backwards would
// make every answer unattributable.
const orient = `<rect x="4" y="4" width="4" height="3"/>`;

const doseCount = doseGroups.reduce((n, g) => n + g.dots.length, 0);
const markedMm2 =
  (ladder.length + doseCount) * Math.PI * (DOT / 2) ** 2;
const markedPct = (markedMm2 / (W * H)) * 100;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Glass dot test - Ø${D} x ${H}mm bottle, ${W.toFixed(1)}mm wrap. Dot Ø${DOT}mm throughout.
     ONE PASS, whichever mode. Repeated passes over the same geometry drive cracks.

     Scoring is the higher-risk mode on glass: laser glass cutting works by
     scribing and then separating along the scribe with thermal shock, and a
     2.5-3mm bottle wall is far too thick to cut, so a traced path installs a
     crack path rather than removing anything. Lowest power that marks; stop at
     the first chipping. Fill mode answers the same question more safely.

     Dot size is a CONSTANT here, not an axis: a scored dot is one spot wide
     whatever diameter is drawn, so a size ladder would measure the plotter.

     Layers by colour:
       #000000  the pitch ladder. ONE setting for all nine patches - it is the
                geometry test, so its dose has to be constant.
       ${DOSE_COLOURS.join('  ')}
                the dose strip, fixed ${DOSE_PITCH}mm pitch, four separate
                settings. Assign increasing power, lowest first.

     Ladder left to right, pitch mm: ${PITCHES.join(' ')}
     Marked area: ${markedPct.toFixed(2)}% of the wrap.
-->
<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(3)}mm" height="${H.toFixed(3)}mm" viewBox="0 0 ${W.toFixed(3)} ${H.toFixed(3)}">
<title>Glass dot test — Ø${D} × ${H}mm, Ø${DOT}mm dots</title>
<g id="ladder" fill="#000000" stroke="none">
${orient}
${ladder.map(circle).join('\n')}
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

console.log(`wrote ${outPath}`);
console.log(`canvas ${W.toFixed(1)} x ${H}mm (Ø${D} bottle), dot Ø${DOT}mm throughout`);
console.log(`ladder ${PITCHES.length} patches of ${PATCH_W.toFixed(1)} x ${LADDER_H}mm, ${ladder.length} dots`);
console.log(`dose strip ${DOSE_COLOURS.length} patches at ${DOSE_PITCH}mm pitch, ${doseCount} dots`);
console.log(`total ${ladder.length + doseCount} dots, marked area ${markedPct.toFixed(2)}% of the wrap`);
console.log(`LADDER  left->right, pitch mm: ${PITCHES.join('  ')}`);
console.log(`
Orientation square is TOP-LEFT, 4mm in from the seam. Finest pitch is the
LEFTMOST patch; the four-colour strip below is the dose ladder.

HOW TO RUN
  * One pass. Whichever mode, never two.
  * Black ladder: ONE setting for all nine patches. It is the geometry test and
    its dose has to be constant or the ladder measures two things at once.
    55W P2S on bare glass, the documented starting point is 10-15% power at
    300mm/s. Start at the bottom of that.
  * Colour strip: four settings, lowest first, stepping up from the ladder's.
    Stop stepping up the moment a patch chips rather than frosts.
  * Air assist low or off. Room-temperature bottle. Lid closed.
  * If you score rather than fill: it is the mode that installs crack paths in
    thick glass, so treat the first bottle as expendable and step power up from
    below rather than down from above.

HOW TO READ
  Ladder: the leftmost patch still showing SEPARATE dots is your minimum pitch.
  Everything finer than it is where a stipple cannot live on this machine. The
  shipped can ladder runs 0.98-1.45mm, so if the 1.0mm patch reads cleanly the
  existing tuning transfers on the pitch axis and only tone has to be rebuilt.
  Dose strip: the brightest patch that is still frost and not chipping is your
  working dose. Read it backlit as well as in ambient - the two disagree, and
  backlit is the one that decides the product.
`);
