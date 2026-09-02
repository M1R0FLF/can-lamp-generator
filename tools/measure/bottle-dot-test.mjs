// Glass test: pitch against density, at ONE known power. Axes are labelled.
//
//   node tools/measure/run.mjs tools/measure/bottle-dot-test.mjs out.svg [diameter] [panelHeight] [dotMm]
//
// The earlier version spent its four colour layers on a power ladder. With
// power settled that budget is free, and density is what it should have been
// spent on, because density is the whole tone mechanism on glass:
//
//   - Dot SIZE cannot vary when scoring — the beam traces a path barely larger
//     than its own spot, so every drawn diameter lands as one 0.15 x 0.2mm mark.
//     Rule 5's AM half is simply unavailable.
//   - That leaves FM. Pitch sets the CEILING (maximum coverage is one spot over
//     one hex cell, pi*(d/2)^2 / (pitch^2*sqrt(3)/2)) and density sets where in
//     that range a tone sits. If density does not read — if 25% and 75% look
//     the same once frosted — then glass gets line art and nothing else, and
//     that is worth knowing before any of the engine is ported.
//
// Columns are pitch, rows are density, everything in one layer at the power you
// already found. ~2% of the wrap marked.
//
// It runs through the harness rather than standing alone because the density
// decision has to be the ENGINE's, not an approximation of it. A first cut used
// a closed-form sine hash and its 50% and 25% patches came out visibly streaky
// — which is rule 10's chaining, and it would have been read as "density looks
// blotchy on glass" when it was the test's own screen doing it. bluenoise.ts
// exists precisely to fix that, so this uses it.
import fs from 'node:fs/promises';

const PITCHES = [0.5, 0.6, 0.7, 0.8, 1.0];
const DENSITIES = [1.0, 0.75, 0.5, 0.25];

const PATCH_W = 26;
const PATCH_H = 12;
const GAP_X = 7;
const GAP_Y = 6;
const LABEL_L = 14; // left gutter for the density labels
const LABEL_T = 12; // top band for the pitch labels

// ---------------------------------------------------------------- labels ---
// Seven-segment strokes rather than SVG <text>: a <text> element needs the
// importing software to resolve a font and convert it to paths, and when it
// cannot, the label silently vanishes or arrives as a filled blob — neither of
// which you discover until the bottle is in the machine. Segments are lines, so
// they import as geometry everywhere.
const SEGS = {
  a: [0, 0, 1, 0], b: [1, 0, 1, 1], c: [1, 1, 1, 2], d: [0, 2, 1, 2],
  e: [0, 1, 0, 2], f: [0, 0, 0, 1], g: [0, 1, 1, 1],
};
const DIGITS = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc',
  5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
};
const GLYPH_W = 2.2;
const GLYPH_H = 3.6;
const GLYPH_GAP = 0.8;
const DOT_ADVANCE = 1.0;

const labelWidth = (text) =>
  [...text].reduce((w, ch) => w + (ch === '.' ? DOT_ADVANCE : GLYPH_W) + GLYPH_GAP, -GLYPH_GAP);

function label(text, x, y) {
  const parts = [];
  let cx = x;
  for (const ch of text) {
    if (ch === '.') {
      const yy = (y + GLYPH_H).toFixed(2);
      parts.push(`<line x1="${cx.toFixed(2)}" y1="${yy}" x2="${(cx + 0.35).toFixed(2)}" y2="${yy}"/>`);
      cx += DOT_ADVANCE + GLYPH_GAP;
      continue;
    }
    for (const seg of DIGITS[ch] ?? '') {
      const [ax, ay, bx, by] = SEGS[seg];
      parts.push(
        `<line x1="${(cx + ax * GLYPH_W).toFixed(2)}" y1="${(y + (ay * GLYPH_H) / 2).toFixed(2)}" ` +
          `x2="${(cx + bx * GLYPH_W).toFixed(2)}" y2="${(y + (by * GLYPH_H) / 2).toFixed(2)}"/>`
      );
    }
    cx += GLYPH_W + GLYPH_GAP;
  }
  return parts.join('');
}

export default async function ({ run, argv }) {
  const outPath = argv[0] || 'bottle-dot-test.svg';
  const D = Number(argv[1] ?? 60.9);
  const H = Number(argv[2] ?? 84);
  const DOT = Number(argv[3] ?? 0.2);
  const W = Math.PI * D;

  const gridW = PITCHES.length * PATCH_W + (PITCHES.length - 1) * GAP_X;
  const gridH = DENSITIES.length * PATCH_H + (DENSITIES.length - 1) * GAP_Y;
  if (LABEL_L + gridW > W - 2 || LABEL_T + gridH > H - 2) {
    throw new Error(`grid ${gridW.toFixed(0)}x${gridH}mm does not fit a ${W.toFixed(0)}x${H}mm wrap.`);
  }

  const dots = await run(({ arg }) => {
    const L = window.LAMP;
    // The engine's own void-and-cluster mask, so the 50% and 25% patches are
    // screened exactly the way a shipped design would be.
    const mask = L.blueNoiseMask();
    const out = [];
    arg.PITCHES.forEach((pitch, c) => {
      arg.DENSITIES.forEach((density, r) => {
        const x0 = arg.LABEL_L + c * (arg.PATCH_W + arg.GAP_X);
        const y0 = arg.LABEL_T + r * (arg.PATCH_H + arg.GAP_Y);
        const rowH = (pitch * Math.sqrt(3)) / 2;
        for (let j = 0; (j + 0.5) * rowH < arg.PATCH_H; j++) {
          for (let i = 0; (i + 0.5 + (j % 2 ? 0.5 : 0)) * pitch < arg.PATCH_W; i++) {
            if (density < 1 && L.maskAt(mask, i, j) >= density) continue;
            out.push([
              +(x0 + (i + 0.5 + (j % 2 ? 0.5 : 0)) * pitch).toFixed(2),
              +(y0 + (j + 0.5) * rowH).toFixed(2),
            ]);
          }
        }
      });
    });
    return out;
  }, { PITCHES, DENSITIES, PATCH_W, PATCH_H, GAP_X, GAP_Y, LABEL_L, LABEL_T });

  const labels = [];
  // Column headers: pitch in mm. toFixed(1) so 1.0 does not print as "1" and
  // read as a different kind of number from its neighbours.
  PITCHES.forEach((pitch, c) => {
    const text = pitch.toFixed(1);
    const x = LABEL_L + c * (PATCH_W + GAP_X) + (PATCH_W - labelWidth(text)) / 2;
    labels.push(label(text, x, LABEL_T - GLYPH_H - 3));
  });
  // Row headers: density percent, in the left gutter, vertically centred.
  DENSITIES.forEach((density, r) => {
    const text = String(Math.round(density * 100));
    const y = LABEL_T + r * (PATCH_H + GAP_Y) + (PATCH_H - GLYPH_H) / 2;
    labels.push(label(text, 2, y));
  });

  const markedPct = ((dots.length * Math.PI * (DOT / 2) ** 2) / (W * H)) * 100;

  await fs.writeFile(outPath, `<?xml version="1.0" encoding="UTF-8"?>
<!-- Glass dot test - Ø${D} x ${H}mm bottle, ${W.toFixed(1)}mm wrap. Ø${DOT}mm dots.
     ONE power setting for everything. Columns are PITCH (mm), rows are DENSITY (%).
     Labels are in their own layer (#4363d8) - engrave them at the same setting,
     or delete that layer if you would rather keep the glass clean.
     ONE PASS. Repeated passes over the same geometry crack glass.

     Columns L->R, pitch mm: ${PITCHES.map((p) => p.toFixed(1)).join(' ')}
     Rows top->bottom, density %: ${DENSITIES.map((d) => Math.round(d * 100)).join(' ')}
     Marked area: ${markedPct.toFixed(2)}% of the wrap. -->
<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(3)}mm" height="${H.toFixed(3)}mm" viewBox="0 0 ${W.toFixed(3)} ${H.toFixed(3)}">
<title>Glass dot test — pitch × density, Ø${D} × ${H}mm</title>
<g id="dots" fill="#000000" stroke="none">
${dots.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${(DOT / 2).toFixed(3)}"/>`).join('\n')}
</g>
<g id="labels" fill="none" stroke="#4363d8" stroke-width="0.3" stroke-linecap="round">
${labels.join('\n')}
</g>
</svg>
`);

  console.log(`wrote ${outPath}`);
  console.log(`Ø${D} x ${H}mm bottle, ${W.toFixed(1)}mm wrap, Ø${DOT}mm dots, one power setting`);
  console.log(`${PITCHES.length} pitches x ${DENSITIES.length} densities, ${dots.length} dots, ${markedPct.toFixed(2)}% of the wrap marked`);
  console.log(`
  COLUMNS left->right = PITCH mm:     ${PITCHES.map((p) => p.toFixed(1)).join('   ')}
  ROWS    top->bottom = DENSITY %:    ${DENSITIES.map((d) => Math.round(d * 100)).join('   ')}
  Both are engraved on the bottle, in the blue label layer.

  One pass, one power - the one you already found. Room-temperature bottle.

  READ IT FOR TWO THINGS
  1. Down a column: do 100 / 75 / 50 / 25 actually look like four different
     tones once frosted? That is the whole tone mechanism on glass - size
     cannot vary when scoring, so if density does not read, the answer is line
     art only and no amount of engine porting changes it.
  2. Across the top row: the finest pitch whose dots are still SEPARATE. Finer
     is brighter, so you want the finest that has not merged, not a safe middle.

  The two interact: a fine pitch at 25% may look the same as a coarse pitch at
  100%. If so, pitch is the only real control and density is decoration.
`);
}
