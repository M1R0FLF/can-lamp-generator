#!/usr/bin/env node
// Quick glass test: 3 pitches x 4 power settings, one bottle.
//
//   node tools/measure/bottle-dot-test.mjs out.svg [diameter] [panelHeight] [dotMm]
//
// Deliberately small. Earlier versions laddered pitch from 0.3mm and dot size
// from 0.15mm, and both axes turned out to be measuring nothing useful:
//
//   - Dot size is not controllable when scoring. A scored dot is the beam
//     tracing a path barely larger than its own spot, so every drawn diameter
//     comes out as one 0.15 x 0.2mm mark.
//   - Fine pitches are not where the work lives. The shipped can tuples run
//     0.98-1.45mm, and at 1mm pitch a 0.2mm spot is five spot-widths from its
//     neighbour — it cannot merge. Testing 0.3mm was answering a question
//     nobody was going to ask.
//
// What is left is the pair that actually decides anything: does it mark at a
// power that doesn't chip, and does the pitch we already use look right. Twelve
// patches, four layer settings to type in, ~1.3% of the wrap marked.
import fs from 'node:fs/promises';

const [outPath = 'bottle-dot-test.svg', dArg = '60.9', hArg = '84', dotArg = '0.2'] =
  process.argv.slice(2);
const D = Number(dArg);
const H = Number(hArg);
const DOT = Number(dotArg);
const W = Math.PI * D;

// Rows: the range the presets actually use, bracketed either side.
const PITCHES = [1.0, 1.25, 1.5];
// Columns: one colour per power setting. Colour is how XCS and LightBurn split
// a file into layers, and a layer is what carries its own power/speed — it is
// the only way to get a dose ladder out of vector geometry, since a circle is
// just a circle.
const COLOURS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231'];

const PATCH_W = 38;
const PATCH_H = 18;
const GAP = 8;

const gridW = COLOURS.length * PATCH_W + (COLOURS.length - 1) * GAP;
const gridH = PITCHES.length * PATCH_H + (PITCHES.length - 1) * GAP;
const X0 = (W - gridW) / 2;
const Y0 = (H - gridH) / 2;

if (gridH > H - 4 || gridW > W - 8) {
  throw new Error(`grid ${gridW.toFixed(0)}x${gridH}mm does not fit a ${W.toFixed(0)}x${H}mm wrap.`);
}

/** Hex field of dots filling one patch. */
function patch(x0, y0, pitch) {
  const rowH = (pitch * Math.sqrt(3)) / 2;
  const out = [];
  for (let j = 0; (j + 0.5) * rowH < PATCH_H; j++) {
    for (let i = 0; (i + 0.5 + (j % 2 ? 0.5 : 0)) * pitch < PATCH_W; i++) {
      out.push({
        x: x0 + (i + 0.5 + (j % 2 ? 0.5 : 0)) * pitch,
        y: y0 + (j + 0.5) * rowH,
      });
    }
  }
  return out;
}

// One group per colour, each holding that column's three pitch patches, so the
// operator sets four numbers rather than twelve.
const groups = COLOURS.map((colour, c) => {
  const dots = [];
  PITCHES.forEach((pitch, r) => {
    dots.push(...patch(X0 + c * (PATCH_W + GAP), Y0 + r * (PATCH_H + GAP), pitch));
  });
  return { colour, dots };
});

const total = groups.reduce((n, g) => n + g.dots.length, 0);
const markedPct = ((total * Math.PI * (DOT / 2) ** 2) / (W * H)) * 100;
const circle = (h) => `<circle cx="${h.x.toFixed(2)}" cy="${h.y.toFixed(2)}" r="${(DOT / 2).toFixed(3)}"/>`;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Glass dot test - Ø${D} x ${H}mm bottle, ${W.toFixed(1)}mm wrap. Ø${DOT}mm dots.
     4 colours = 4 power settings, lowest first. Rows within each colour are
     pitch: ${PITCHES.join(' / ')}mm, top to bottom.
     ONE PASS. Repeated passes over the same geometry crack glass. -->
<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(3)}mm" height="${H.toFixed(3)}mm" viewBox="0 0 ${W.toFixed(3)} ${H.toFixed(3)}">
<title>Glass dot test — Ø${D} × ${H}mm</title>
<g id="orient" fill="#000000"><rect x="4" y="4" width="4" height="3"/></g>
${groups
  .map((g, k) => `<g id="power-${k + 1}" fill="${g.colour}" stroke="none">\n${g.dots.map(circle).join('\n')}\n</g>`)
  .join('\n')}
</svg>
`;

await fs.writeFile(outPath, svg);

console.log(`wrote ${outPath}`);
console.log(`Ø${D} x ${H}mm bottle, ${W.toFixed(1)}mm wrap, Ø${DOT}mm dots`);
console.log(`${COLOURS.length} colours x ${PITCHES.length} pitches, ${total} dots, ${markedPct.toFixed(2)}% of the wrap marked`);
console.log(`
  COLUMNS (colour) = power.  ${COLOURS.join('  ')}  <- set these 4, lowest first
  ROWS  top->bottom = pitch. ${PITCHES.join('  ')} mm
  Orientation square: top-left, 4mm in from the seam.

  One pass. Start around 10-15% power at 300mm/s on a 55W P2S and step up
  across the four colours. Room-temperature bottle, air assist low.

  Read: the brightest column that frosts without chipping is your power.
  Then check the three rows still read as separate dots at that power.
`);
