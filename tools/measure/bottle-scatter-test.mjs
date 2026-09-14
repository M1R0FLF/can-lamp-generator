// A small mixed-content bottle test: random shapes from the library plus a
// text label, in the engine's normal size-varying tone mode.
//
//   node tools/measure/run.mjs tools/measure/bottle-scatter-test.mjs OUT [text] [seed] [diameter] [panelHeight]
//
// The earlier glass tests all ran FM at one fixed dot size, on the reasoning
// that a scored dot is one spot wide whatever diameter is drawn. Cutting a real
// bottle said otherwise — diameter does come through — so this one puts the
// size axis back and exercises the engine's default HYBRID mode, where density
// carries the low end of the tone range and diameter the top.
//
// That makes it a different kind of test from the pitch/density grid. It is not
// laddering a parameter; it is asking whether a mixed, ordinary design survives:
// solid forms of several sizes, thin curved outlines, and letterforms, all in
// one job at one setting. Letters are the interesting part, because they fail
// differently from shapes — a bowl that fills in or a stem that breaks is
// obvious in a way a slightly wrong leaf is not.
//
// Shapes are drawn at random from the library but from a SEEDED generator, so
// the same command reproduces the same bottle. A test you cannot re-cut after
// changing one setting is not a test.
import fs from 'node:fs/promises';
import path from 'node:path';

export default async function ({ run, argv }) {
  const outDir = argv[0] || 'bottle-scatter-out';
  const TEXT = argv[1] || 'MIRO';
  const SEED = Number(argv[2] ?? 7);
  const D = Number(argv[3] ?? 60.9);
  const H = Number(argv[4] ?? 84);

  const out = await run(({ arg }) => {
    const L = window.LAMP;
    const can = { diameterMm: arg.D, heightMm: arg.H, ppm: 8 };

    // Seeded so the scatter is reproducible; mulberry32 is the engine's own.
    const rng = L.mulberry32(arg.SEED);
    const pick = (a) => a[Math.floor(rng() * a.length)];

    // Drawn from the whole library minus the band/frame shapes, which are
    // full-width furniture rather than motifs and would dominate a scatter.
    const ids = L.SHAPE_LIBRARY.map((s) => s.id).filter(
      (id) => !id.startsWith('band-') && !id.startsWith('frame-')
    );

    // `size` is a half-extent: a shape drawn at size s spans roughly 2s. All
    // three constraints below are in mm and use that, because the first version
    // compared fractions against fractions and produced shapes sliced off at
    // the top edge and one sitting on the text.
    const TEXT_MM = 17;
    const textCy = arg.H / 2;
    // Sizes are ASSIGNED, not sampled. Drawing a random size and then rejecting
    // placements that do not fit biases hard against the big ones — the first
    // version asked for 10-22mm and delivered seven shapes of 10-12, which is
    // exactly the spread the test exists to have. Largest first, because a 22mm
    // shape has far fewer legal positions than a 10mm one.
    const SIZES = [22, 20, 18, 16, 14, 12, 10];
    const shapes = [];
    for (const size of SIZES) {
      // Vertical placement is clamped so the whole shape stays on the panel.
      // x is NOT clamped: the canvas wraps, so a shape crossing the seam is
      // correct and worth having in the test (rule 1).
      const margin = size + 2;
      if (margin * 2 >= arg.H) continue;
      for (let tries = 0; tries < 600; tries++) {
        const yMm = margin + rng() * (arg.H - 2 * margin);
        const xFrac = rng();
        // Clear of the label's actual BOX, not of a full-width band. On an 84mm
        // panel a band reserved across the whole wrap leaves nowhere for a 22mm
        // shape to stand — the previous version placed two of seven for exactly
        // that reason. "MIRO" is ~42mm of a 191mm circumference, so outside
        // those x the full height is free.
        const xMm = xFrac * Math.PI * arg.D;
        const halfW = TEXT_MM * 0.62 * arg.TEXT.length * 0.5;
        let dxText = Math.abs(xMm - (Math.PI * arg.D) / 2);
        dxText = Math.min(dxText, Math.PI * arg.D - dxText);
        const overlapsX = dxText < halfW + size + 5;
        const overlapsY = Math.abs(yMm - textCy) < TEXT_MM * 0.6 + size + 5;
        if (overlapsX && overlapsY) continue;
        const yFrac = yMm / arg.H;
        // keep them apart so the test reads as separate objects, not a texture
        const tooClose = shapes.some((s) => {
          const dx = Math.abs(s.xFrac - xFrac) * Math.PI * arg.D;
          const wrapped = Math.min(dx, Math.PI * arg.D - dx);
          const dy = Math.abs(s.yFrac - yFrac) * arg.H;
          return Math.hypot(wrapped, dy) < (s.size + size) * 1.1;
        });
        if (tooClose) continue;
        shapes.push({
          id: `s${shapes.length}`,
          shapeId: pick(ids),
          xFrac,
          yFrac,
          size,
          rotation: Math.round(rng() * 360),
        });
        break;
      }
    }

    const annotation = {
      text: arg.TEXT,
      xFrac: 0.5, // the front of the bottle, per rule 9
      yAnchor: 'center',
      yOffsetMm: 0,
      sizeMm: 17,
    };

    // Hybrid, i.e. the engine's default: density below the knee, diameter above
    // it. dMin is one P2S spot; dMax is the size the real cut showed is
    // reachable. Pitch 0.7 sits above the merge floor and still gives a usable
    // brightness ceiling.
    const r = L.generate(can, { kind: 'custom', shapes }, {
      pitchMm: 0.7, mode: 'hybrid', dMin: 0.2, dMax: 0.45, jitter: 0.05,
    }, annotation);

    let area = 0;
    for (const h of r.holes) area += Math.PI * h.r * h.r;
    return {
      W: r.W, H: r.H, n: r.holes.length,
      openPct: +((area / (r.W * r.H)) * 100).toFixed(2),
      minWeb: +r.minWeb.toFixed(3),
      shapes: shapes.map((s) => `${s.shapeId}@${Math.round(s.size)}mm`),
      holes: r.holes.map((h) => [+h.x.toFixed(2), +h.y.toFixed(2), +h.r.toFixed(3)]),
    };
  }, { D, H, SEED, TEXT });

  await fs.mkdir(outDir, { recursive: true });
  const cut = path.join(outDir, 'scatter-test.svg');
  const lit = path.join(outDir, 'scatter-test-lit.svg');

  await fs.writeFile(cut, `<?xml version="1.0" encoding="UTF-8"?>
<!-- Scatter test - Ø${D} x ${H}mm bottle, ${out.W.toFixed(1)}mm wrap, seed ${SEED}.
     Hybrid tone: dot Ø varies 0.20-0.45mm, pitch 0.7mm.
     ONE PASS at the power you settled on. Shapes: ${out.shapes.join(', ')} -->
<svg xmlns="http://www.w3.org/2000/svg" width="${out.W.toFixed(3)}mm" height="${out.H.toFixed(3)}mm" viewBox="0 0 ${out.W.toFixed(3)} ${out.H.toFixed(3)}">
<title>Scatter test — ${TEXT}, Ø${D} × ${H}mm</title>
<g id="dots" fill="#000000" stroke="none">
${out.holes.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('\n')}
</g>
</svg>
`);

  await fs.writeFile(lit, `<svg xmlns="http://www.w3.org/2000/svg" width="${out.W.toFixed(2)}mm" height="${out.H.toFixed(2)}mm" viewBox="0 0 ${out.W.toFixed(2)} ${out.H.toFixed(2)}">
<rect width="100%" height="100%" fill="#2a1608"/>
<g fill="#ffcf90">
${out.holes.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${(r * 1.35).toFixed(3)}"/>`).join('')}
</g>
</svg>
`);

  console.log(`wrote ${cut}`);
  console.log(`      ${lit}   (preview only — frost is bright on dark glass)`);
  console.log(`Ø${D} x ${H}mm bottle, ${out.W.toFixed(1)}mm wrap, "${TEXT}", seed ${SEED}`);
  console.log(`${out.n} dots, ${out.openPct}% open, Ø0.20-0.45mm at 0.7mm pitch, closest web ${out.minWeb}mm`);
  console.log(`shapes: ${out.shapes.join(', ')}`);
  console.log(`
  One pass, at the power you already found. Same seed reproduces this bottle;
  change the seed for a different scatter.

  READ IT FOR
  1. The letters. They fail more legibly than shapes do - a filled-in bowl or a
     broken stem tells you the dot size range is wrong in a way a slightly
     mangled leaf does not.
  2. The size spread. Shapes run 10-22mm, straddling rule 3's 16mm legible
     floor on purpose. Where they stop reading on GLASS is the number we do not
     have yet; the 16mm figure was measured on backlit aluminium.
  3. Whether varying dot Ø is doing anything visible at all. If the 0.20 and
     0.45mm ends look the same once frosted, hybrid buys nothing here and the
     glass path should stay on FM.
`);
}
