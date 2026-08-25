#!/usr/bin/env node
// Emit a laser calibration can: one real cut that replaces three guesses.
//
//   node tools/measure/calibration-tile.mjs out.svg [diameter] [height]
//
// Portraits need roughly half the pitch the presets use (measured — see the
// pitch sweep), and that pushes into territory nothing has been cut in. Three
// quantities become load-bearing and none of them can be derived from geometry:
//
//   1. The smallest hole that reliably penetrates 0.1mm aluminium. Below it a
//      hole passes NO light, so the dark end of the tone range silently stops
//      existing. Proven jobs used 0.28mm minimum; the portrait tuples ask for
//      0.14-0.20mm.
//   2. The narrowest web that survives cutting AND handling, with the rotary's
//      real runout included rather than assumed.
//   3. Whether dense areas bridge or distort from heat, which per-hole geometry
//      cannot see at all.
//
// Cut this on a scrap can with the SAME setup as a real job (speed, passes,
// rotary), then hold it to a light and read the three answers off it.
//
// No text: engraved labels would need their own cut settings and would confuse
// the heat test. Blocks run left to right in a documented order, printed below.
import fs from 'node:fs/promises';

const [outPath = 'calibration-tile.svg', dArg = '65', hArg = '142'] = process.argv.slice(2);
const D = Number(dArg), H = Number(hArg);
const W = Math.PI * D;

const holes = [];
const circle = (x, y, d) => holes.push({ x, y, r: d / 2 });

/**
 * A block of cols x rows holes on a hex grid at the given pitch and diameter.
 *
 * Sized by hole COUNT rather than by area, for two reasons: every block then
 * costs the same cut time regardless of pitch, and the blocks stay comparable
 * to each other. Sizing by area instead made the fine-pitch patches enormous —
 * the first version of this file came out at 25,798 holes and 13.5 hours, which
 * is not a calibration, it is a job.
 */
function block(x0, y0, cols, rows, pitch, d) {
  const rowH = (pitch * Math.sqrt(3)) / 2;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      circle(x0 + (i + (j % 2 ? 0.5 : 0)) * pitch, y0 + j * rowH, d);
    }
  }
  return { w: cols * pitch, h: rows * rowH };
}

const notes = [];

// ---- Test 1: smallest hole that penetrates -------------------------------
// Pitch held generous and CONSTANT at 1.6mm so the web is never the variable —
// only the diameter changes across the row.
const DIAMS = [0.10, 0.12, 0.14, 0.16, 0.18, 0.20, 0.22, 0.24, 0.26, 0.28, 0.30, 0.34];
{
  const y = 14, gap = 5;
  let x = 8;
  for (const d of DIAMS) {
    const b = block(x, y, 4, 5, 1.6, d);
    x += b.w + gap;
  }
  notes.push(`Test 1  y=${y}mm  hole Ø ladder, constant 1.6mm pitch, ${DIAMS.length} blocks L->R: ${DIAMS.map((d) => d.toFixed(2)).join(' ')}`);
  notes.push('        Read: the leftmost block where EVERY hole passes light = your minimum usable diameter.');
}

// ---- Test 2: narrowest surviving web -------------------------------------
// Diameter held constant at 0.24mm; the pitch changes so the nominal web is
// the only variable. Nominal web = pitch - d.
const WEBS = [0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.50];
{
  const y = 50, gap = 9, d = 0.24;
  let x = 8;
  for (const web of WEBS) {
    const b = block(x, y, 8, 8, d + web, d);
    x += b.w + gap;
  }
  notes.push(`Test 2  y=${y}mm  web ladder, constant Ø0.24mm, ${WEBS.length} blocks L->R nominal web: ${WEBS.map((w) => w.toFixed(2)).join(' ')}`);
  notes.push('        Read: the leftmost block with no torn or bridged webs = your minimum web, rotary runout included.');
}

// ---- Test 3: real tuples at full density ---------------------------------
// Worst case for both heat and webs: every cell filled at that tuple's LARGEST
// hole. If a tuple survives here it survives any picture.
const TUPLES = [
  { pitch: 1.45, dMax: 0.52, label: 'shipped' },
  { pitch: 0.98, dMax: 0.40, label: 'ultra' },
  { pitch: 0.85, dMax: 0.36, label: 'cand' },
  { pitch: 0.75, dMax: 0.32, label: 'cand' },
  { pitch: 0.65, dMax: 0.30, label: 'cand' },
];
{
  const y = 78, gap = 12;
  let x = 8;
  for (const t of TUPLES) {
    const b = block(x, y, 12, 14, t.pitch, t.dMax);
    x += b.w + gap;
  }
  notes.push(`Test 3  y=${y}mm  full-density patches, ${TUPLES.length} blocks L->R pitch/Ømax: ${TUPLES.map((t) => `${t.pitch}/${t.dMax}`).join('  ')}`);
  notes.push('        Read: check for bridged holes, buckling, or a patch that tears when flexed.');
}

const body = holes
  .map((h) => `<circle cx="${h.x.toFixed(3)}" cy="${h.y.toFixed(3)}" r="${h.r.toFixed(4)}"/>`)
  .join('\n');
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(3)}mm" height="${H.toFixed(3)}mm" viewBox="0 0 ${W.toFixed(3)} ${H.toFixed(3)}">
<title>Laser calibration — Ø${D}x${H}mm</title>
<g id="holes" fill="#000000" stroke="none">
${body}
</g>
</svg>
`;
await fs.writeFile(outPath, svg);

console.log(`wrote ${outPath}`);
console.log(`canvas ${W.toFixed(1)} x ${H}mm (Ø${D}), ${holes.length} holes`);
console.log(`cut time estimate at 10mm/s x5 passes: ${(holes.length * 3.78 * 5 / 10 / 60).toFixed(0)} min\n`);
for (const n of notes) console.log(n);
