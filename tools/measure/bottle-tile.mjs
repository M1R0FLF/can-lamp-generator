#!/usr/bin/env node
// Emit a CO2 calibration wrap for a dark glass bottle: one real job that
// replaces the four guesses standing between us and a glass substrate mode.
//
//   node tools/measure/bottle-tile.mjs OUTDIR [diameter] [panelHeight] [dpi]
//
// Defaults are a 330ml amber longneck (O-I 30416: Ø60.9mm body, 84.0mm body
// label panel — the glassmaker's own statement of the flat cylindrical band,
// which is the right analogue of our can's straight-wall-only `heightMm`).
//
// WHY THIS EXISTS
//
// The can tool's whole model is that a hole is an ABSENCE of material: metal
// is opaque, an aperture transmits, contrast is 100% vs 0%. On glass nothing
// is removed. A CO2 laser at 10.6um is absorbed in the first few microns and
// leaves a micro-cracked, light-scattering skin; both marked and unmarked
// glass still transmit. So contrast is ANGULAR (specular vs diffuse), not
// radiometric, and every tuned constant in qualityPresets.ts, photo.ts and
// rule 8's open-area guardrail has no glass analogue at all.
//
// Four quantities become load-bearing and not one can be derived from
// geometry or found in the literature:
//
//   1. Whether backlit contrast exists AT ALL, and how it depends on the lamp.
//      Radiance is conserved in passive optics, so a diffuser in front of a
//      UNIFORM source shows the same luminance as the glass beside it — the
//      design would simply vanish. The prediction is that all the contrast
//      comes from the interior light being angularly non-uniform, i.e. a bare
//      directional strip LED with air around it. Nobody has published a
//      backlit contrast ratio for CO2 frost on amber glass; this is the
//      highest-risk unknown in the idea and Test 1 is aimed straight at it.
//   2. The dot pitch at which marks stop being separate. The P2S spot is
//      0.15 x 0.2mm and dots closer than about 2x the spot merge into
//      continuous frost, taking the density-carries-tone mechanism (rule 5)
//      with them.
//   3. The smallest dot that leaves a visible mark, which sets dMin the way
//      "smallest hole that penetrates" does on aluminium.
//   4. The dose window between "no mark" and "chipped". Manufacturers all say
//      to run glass at 70-80% black rather than 100% — Epilog and Trotec both
//      put it in the material notes — so the wedge tests exactly that.
//
// HOW DOSE IS VARIED. It can't be encoded in geometry, so the tile uses grey
// level: XCS bitmap engrave modulates power by grey, which is the same knob
// the 70-80%-black advice turns. That gets a dose ladder inside a single pass.
//
// READ THE OPERATOR NOTES PRINTED AT THE END BEFORE RUNNING. One of them is
// load-bearing: XCS must engrave this in GRAYSCALE mode, never in dithering /
// halftone mode. The tile is already a halftone; letting the software re-screen
// it destroys every geometry answer the tile exists to give.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const [outDir = 'bottle-tile-out', dArg = '60.9', hArg = '84', dpiArg = '508'] =
  process.argv.slice(2);
const D = Number(dArg);
const H = Number(hArg);
const DPI = Number(dpiArg);
const W = Math.PI * D;
const PPM = DPI / 25.4; // px per mm

// ---------------------------------------------------------------- raster ---
// 8-bit greyscale, black = engrave (the universal laser convention), so the
// buffer starts white and marks subtract. Written by hand rather than through
// a Canvas because the sibling calibration-tile.mjs is a plain node script and
// this stays one; a dependency-free PNG writer is 40 lines.
const Wp = Math.round(W * PPM);
const Hp = Math.round(H * PPM);
const img = new Uint8Array(Wp * Hp).fill(255);

/** Paint coverage*ink of blackness at a pixel, keeping the darkest wins. */
function ink(px, py, coverage, level) {
  if (px < 0 || py < 0 || px >= Wp || py >= Hp) return;
  const v = Math.round(255 * (1 - level * coverage));
  const i = py * Wp + px;
  if (v < img[i]) img[i] = v;
}

/**
 * A filled disc in mm, 3x3 supersampled.
 *
 * Supersampling is not cosmetic here: at 508 DPI a 0.15mm dot is three pixels
 * across, so hard thresholding would quantise the dot-diameter ladder into
 * about four distinct sizes and Test 3 would be measuring the rasteriser
 * rather than the laser.
 */
function disc(cxMm, cyMm, dMm, level = 1) {
  const r = (dMm / 2) * PPM;
  const cx = cxMm * PPM;
  const cy = cyMm * PPM;
  const x0 = Math.floor(cx - r - 1);
  const x1 = Math.ceil(cx + r + 1);
  const y0 = Math.floor(cy - r - 1);
  const y1 = Math.ceil(cy + r + 1);
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      let hit = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const dx = px + (sx + 0.5) / 3 - cx;
          const dy = py + (sy + 0.5) / 3 - cy;
          if (dx * dx + dy * dy <= r * r) hit++;
        }
      }
      if (hit) ink(px, py, hit / 9, level);
    }
  }
}

/** A filled axis-aligned rectangle in mm. */
function rect(xMm, yMm, wMm, hMm, level = 1) {
  const x0 = Math.round(xMm * PPM);
  const y0 = Math.round(yMm * PPM);
  const x1 = Math.round((xMm + wMm) * PPM);
  const y1 = Math.round((yMm + hMm) * PPM);
  for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) ink(px, py, 1, level);
}

/** Hex field of discs filling a patch. Returns the dot count. */
function dotPatch(x0, y0, w, h, pitch, dMm, level = 1) {
  const rowH = (pitch * Math.sqrt(3)) / 2;
  let n = 0;
  for (let j = 0; (j + 0.5) * rowH < h; j++) {
    const y = y0 + (j + 0.5) * rowH;
    for (let i = 0; (i + 0.5) * pitch < w; i++) {
      const x = x0 + (i + 0.5 + (j % 2 ? 0.5 : 0)) * pitch;
      if (x - x0 > w) continue;
      disc(x, y, dMm, level);
      n++;
    }
  }
  return n;
}

/** Parallel horizontal bars of a given width — the raster "score" analogue. */
function barPatch(x0, y0, w, h, widthMm, spacingMm, level = 1) {
  let n = 0;
  for (let y = y0 + spacingMm / 2; y < y0 + h; y += spacingMm) {
    rect(x0, y, w, widthMm, level);
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- layout ---
// Five bands down an 84mm panel. Patches are ~12mm tall: well under rule 3's
// 16mm legible floor, which is correct here because a calibration tile is read
// at arm's length, not from across a room.
const MARGIN_X = 6;
const ROW_H = 12;
const ROWS_Y = [4, 19, 34, 49, 64];
const GAP = 3;
const notes = [];

/** Evenly divide the usable width into n patches. */
function slots(n) {
  const w = (W - 2 * MARGIN_X - (n - 1) * GAP) / n;
  return { w, x: (i) => MARGIN_X + i * (w + GAP) };
}

// ---- Test 1: does backlit contrast exist, and what does the lamp do? ------
// Deliberately the simplest possible geometry: solid frosted rectangles at
// five doses next to bare glass. Everything else on the tile is worthless if
// this row does not show a difference when lit.
const T1_LEVELS = [1.0, 0.85, 0.7, 0.55, 0.4];
{
  const y = ROWS_Y[0];
  const s = slots(T1_LEVELS.length + 1);
  T1_LEVELS.forEach((lv, i) => rect(s.x(i), y, s.w, ROW_H, lv));
  // last slot deliberately left bare: the unmarked reference
  notes.push(
    `Test 1  y=${y}mm  solid dose ladder, ${T1_LEVELS.length} patches L->R at ` +
      `${T1_LEVELS.map((l) => `${Math.round(l * 100)}%`).join(' ')} black, then ONE BARE slot as reference.`
  );
  notes.push(
    '        Read it THREE ways and write down all three:'
  );
  notes.push(
    '          (a) ambient, unlit — which doses look white vs grey vs chipped/rough;'
  );
  notes.push(
    '          (b) backlit with a BARE strip LED inside, air around it, no diffuser;'
  );
  notes.push(
    '          (c) backlit with that same LED behind a diffuser (paper sleeve is fine).'
  );
  notes.push(
    '        The prediction is that (b) shows strong contrast and (c) shows almost none,'
  );
  notes.push(
    '        because radiance is conserved: a diffuser in front of an already-uniform source'
  );
  notes.push(
    '        cannot out-shine the glass beside it. If (c) is as good as (b), that prediction'
  );
  notes.push(
    '        is wrong and the lamp design gets much easier. If (b) is ALSO weak, stop here —'
  );
  notes.push(
    '        the substrate does not work backlit and no amount of pattern tuning fixes it.'
  );
}

// ---- Test 2: the pitch at which dots stop being separate -----------------
// Dot diameter held CONSTANT so pitch is the only variable, exactly as the
// can tile holds pitch constant for its diameter ladder.
const T2_PITCH = [0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.2, 1.5];
{
  const y = ROWS_Y[1];
  const s = slots(T2_PITCH.length);
  let total = 0;
  T2_PITCH.forEach((p, i) => {
    total += dotPatch(s.x(i), y, s.w, ROW_H, p, 0.3, 0.8);
  });
  notes.push(
    `Test 2  y=${y}mm  pitch ladder, constant Ø0.30mm dot at 80% black, ${T2_PITCH.length} patches ` +
      `L->R: ${T2_PITCH.map((p) => p.toFixed(2)).join(' ')}mm  (${total} dots)`
  );
  notes.push(
    '        Read: the leftmost patch where dots are still SEPARATE = your minimum pitch.'
  );
  notes.push(
    '        Expect merging somewhere around 0.3-0.5mm, i.e. ~2x the 0.15x0.2mm P2S spot.'
  );
  notes.push(
    '        Good news if so: the shipped ladder runs 0.98-1.45mm, far above it.'
  );
}

// ---- Test 3: the smallest dot that marks at all --------------------------
// Pitch held generous and constant at 1.2mm so merging is never the variable.
// This is the glass analogue of the can tile's "smallest hole that penetrates":
// below it the dark end of the tone range silently stops existing.
const T3_DIAM = [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5];
{
  const y = ROWS_Y[2];
  const s = slots(T3_DIAM.length);
  let total = 0;
  T3_DIAM.forEach((d, i) => {
    total += dotPatch(s.x(i), y, s.w, ROW_H, 1.2, d, 0.8);
  });
  notes.push(
    `Test 3  y=${y}mm  dot Ø ladder, constant 1.2mm pitch at 80% black, ${T3_DIAM.length} patches ` +
      `L->R: ${T3_DIAM.map((d) => d.toFixed(2)).join(' ')}mm  (${total} dots)`
  );
  notes.push(
    '        Read: the leftmost patch where EVERY dot marks = your dMin. Below the 0.15-0.2mm'
  );
  notes.push(
    '        spot the machine cannot make a smaller mark, only a fainter one, so expect the'
  );
  notes.push(
    '        ladder to stop resolving rather than to fade smoothly.'
  );
}

// ---- Test 4: score vs fill, at matched coverage --------------------------
// The question is whether a scored line and a filled area differ in how they
// diffuse light, or only in how much area they cover. Surface damage is the
// same physics either way, so the expectation is "area only" — but a line one
// spot wide is 0.15-0.2mm, which backlit is a thin filament, and that is rule 3
// restated in a worse form. Bar width is the variable; spacing is set per patch
// to hold COVERAGE at 25%, so any visible difference is not a coverage
// difference. The reference patch is solid at the SAME 80% dose rather than at
// 25% black: dose and area are separate axes and Test 1 already ladders dose,
// so this row has to hold dose fixed or it would move both at once.
const T4_BARS = [0.15, 0.2, 0.3, 0.5, 0.8, 1.2];
{
  const y = ROWS_Y[3];
  const s = slots(T4_BARS.length + 1);
  T4_BARS.forEach((wdt, i) => barPatch(s.x(i), y, s.w, ROW_H, wdt, wdt / 0.25, 0.8));
  rect(s.x(T4_BARS.length), y, s.w, ROW_H, 0.8);
  notes.push(
    `Test 4  y=${y}mm  score-vs-fill at MATCHED 25% coverage and matched 80% dose, ` +
      `${T4_BARS.length} bar patches L->R width: ${T4_BARS.map((b) => b.toFixed(2)).join(' ')}mm, ` +
      'then one SOLID patch (100% coverage, same 80% dose) as the reference.'
  );
  notes.push(
    "        Bars run AROUND the circumference, parallel to the image's long axis; spacing is"
  );
  notes.push(
    '        set per patch to hold coverage at 25%. If your setup ends up rastering ACROSS the'
  );
  notes.push(
    '        bars rather than along them, say so when reporting - it changes how cleanly the'
  );
  notes.push(
    '        machine starts and stops each mark, which is not the optical question being asked.'
  );
  notes.push(
    '        Read: backlit, do the narrow-bar patches look as bright as the wide-bar ones and'
  );
  notes.push(
    '        as the solid one? If yes, only AREA matters and score buys nothing over fill.'
  );
  notes.push(
    '        If the narrow bars look brighter per unit area, scoring really does diffuse'
  );
  notes.push(
    '        differently and the glass mode wants a line-based generator, not a stipple.'
  );
  notes.push(
    '        Compare against bottle-tile-score.svg, which is the same ladder as TRUE vectors.'
  );
}

// ---- Test 5: the shipped tuples, at full density -------------------------
// Worst case for heat and merging both: every cell filled at that tuple's
// LARGEST hole. If a tuple survives here it survives any picture — and if the
// existing ladder survives, the glass mode inherits the pitch axis for free
// and only the tone mapping has to be rebuilt.
const T5_TUPLES = [
  { pitch: 2.2, d: 0.62, label: 'Draft' },
  { pitch: 1.45, d: 0.52, label: 'Standard' },
  { pitch: 1.15, d: 0.46, label: 'Fine' },
  { pitch: 0.98, d: 0.4, label: 'Ultra' },
];
{
  const y = ROWS_Y[4];
  const s = slots(T5_TUPLES.length + 1);
  let total = 0;
  T5_TUPLES.forEach((t, i) => {
    total += dotPatch(s.x(i), y, s.w, ROW_H, t.pitch, t.d, 0.8);
  });
  // a half-tone version of Standard, so tone response is visible next to full
  total += dotPatch(s.x(T5_TUPLES.length), y, s.w, ROW_H, 1.45, 0.52 * Math.SQRT1_2, 0.8);
  notes.push(
    `Test 5  y=${y}mm  shipped quality tuples at FULL density, 80% black, L->R: ` +
      `${T5_TUPLES.map((t) => `${t.label} ${t.pitch}/${t.d}`).join('  ')}, then Standard at half open area.` +
      `  (${total} dots)`
  );
  notes.push(
    '        Read: does each patch still read as separate dots, and does the half-area patch'
  );
  notes.push(
    '        look meaningfully dimmer than full Standard? The second half is the real question —'
  );
  notes.push(
    '        it is whether density still carries tone (rule 5) once dots are near the spot size.'
  );
}

// ---- orientation mark ----------------------------------------------------
// Wrapped around a cylinder, a symmetric tile is ambiguous end-for-end and the
// row order becomes unreadable. One solid square near the seam at the TOP fixes
// the reading direction. Costs a few mm2 of frost and no time worth counting.
rect(MARGIN_X, H - 5, 4, 3, 1);
notes.push(
  `Orientation: one solid 4x3mm square at x=${MARGIN_X}mm, ${(H - 5).toFixed(0)}mm down — that corner is` +
    ' the BOTTOM-LEFT of the layout above. Test 1 is the row furthest from it.'
);

// ------------------------------------------------------------------- PNG ---
// Minimal 8-bit greyscale writer: signature, IHDR, pHYs (so the importer reads
// real-world size instead of guessing), IDAT, IEND.
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function writePng(width, height, grey, dpi) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type: greyscale
  // pixels per METRE, which is what PNG stores; this is what makes the file
  // import at its true mm size instead of at whatever the software assumes.
  const ppm = Math.round((dpi / 25.4) * 1000);
  const phys = Buffer.alloc(9);
  phys.writeUInt32BE(ppm, 0);
  phys.writeUInt32BE(ppm, 4);
  phys[8] = 1; // unit: metre
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // filter: none
    Buffer.from(grey.buffer, grey.byteOffset + y * width, width).copy(
      raw,
      y * (width + 1) + 1
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('pHYs', phys),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------- companion score vector ---
// Test 4 again, but as true vector lines. In LightBurn/XCS terms this is Line
// mode rather than Fill: one continuous pass along the path instead of the
// raster laying it down scan line by scan line. Same nominal geometry, and a
// different toolpath and therefore a different effective dose — which is
// exactly the comparison "should scoring diffuse differently?" needs.
// Its own colour so it lands on its own layer and takes its own power/speed.
const scoreLines = [];
{
  const s = slots(T4_BARS.length + 1);
  T4_BARS.forEach((wdt, i) => {
    const x0 = s.x(i);
    const spacing = wdt / 0.25;
    for (let y = ROWS_Y[3] + spacing / 2; y < ROWS_Y[3] + ROW_H; y += spacing) {
      scoreLines.push(
        `<line x1="${x0.toFixed(3)}" y1="${y.toFixed(3)}" x2="${(x0 + s.w).toFixed(3)}" y2="${y.toFixed(3)}"/>`
      );
    }
  });
}
const scoreSvg = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Line-mode companion to Test 4 of bottle-tile.png. Run this as a VECTOR
     (Line / Score) operation, not as a fill, on the same bottle in a second
     pass positioned beside the raster tile - or on its own bottle if that is
     easier to align. The point is to compare one continuous pass against the
     raster rendering of the same geometry. -->
<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(3)}mm" height="${H.toFixed(3)}mm" viewBox="0 0 ${W.toFixed(3)} ${H.toFixed(3)}">
<title>Score-mode companion — Ø${D} × ${H}mm</title>
<g id="score" fill="none" stroke="#ff0000" stroke-width="0.05">
${scoreLines.join('\n')}
</g>
</svg>
`;

// ------------------------------------------------------------------ write ---
await fs.mkdir(outDir, { recursive: true });
const pngPath = path.join(outDir, 'bottle-tile.png');
const svgPath = path.join(outDir, 'bottle-tile-score.svg');
await fs.writeFile(pngPath, writePng(Wp, Hp, img, DPI));
await fs.writeFile(svgPath, scoreSvg);

// Raster time on a gantry is scan length / speed: the head sweeps the panel
// height once per line, and steps one line interval around the circumference.
// Accel at the turnaround is not modelled, so treat this as a floor - real
// jobs commonly land 1.5-2x it.
const SPEED = 600; // mm/s, P2S maximum engrave speed
const INTERVAL = 0.1; // mm, ~254 DPI, the middle of the documented glass range
const lines = W / INTERVAL;
const seconds = (lines * H) / SPEED;

console.log(`wrote ${pngPath}`);
console.log(`      ${svgPath}`);
console.log(
  `canvas ${W.toFixed(1)} x ${H}mm (Ø${D} bottle, ${DPI} DPI, ${Wp} x ${Hp} px)\n`
);
for (const n of notes) console.log(n);
console.log(`
OPERATOR NOTES — xTool P2S + RA2 Pro, roller mode
  * Engrave in GRAYSCALE mode. NOT dithering, NOT halftone, NOT threshold. The
    tile is already a halftone; letting XCS re-screen it destroys Tests 2-5.
    This applies to the real generator output too, not just to this tile.
  * The image is ${W.toFixed(1)}mm wide = the bottle's circumference. That axis maps to the
    ROTARY. The ${H}mm axis runs along the bottle. Set the roller to the measured
    body diameter, not the nominal one, or the wrap will not close.
  * Focus on the apex of the bottle, i.e. the highest point of the curve.
  * Start LOW on power. Epilog's published glass tables run 100% power at low
    speed, but they assume the wet-paper/dish-soap sacrificial layer their own
    note attaches to; every bare-glass guide runs roughly a third of that dose.
    On a 55W P2S, ~10-15% power at 300mm/s is the documented starting point.
  * If you use the wet paper towel: air assist OFF, or it dries mid-job. Note
    that nobody documents wet paper on a FULL-WRAP rotary job — keeping it wet
    and adhered through a rotation is an open problem, so run the first tile
    bare and only then decide whether masking is worth the trouble.
  * Rough raster time at ${SPEED}mm/s and a ${INTERVAL}mm line interval: ${(seconds / 60).toFixed(0)} min
    (a floor — no turnaround accel in the model, so expect 1.5-2x).

WHAT TO SEND BACK
  Test 1 (a/b/c), and for tests 2-5 the leftmost patch that still passes. Those
  five numbers are what the glass substrate mode gets built on; until they
  exist, any constant I write for it would be invented.
`);
