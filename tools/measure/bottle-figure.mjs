// A real design as dots on a bottle, to see whether anything reads at all.
//
//   node tools/measure/run.mjs tools/measure/bottle-figure.mjs OUTDIR [diameter] [panelHeight] [pitch]
//
// The grid tests answer "what settings mark glass without cracking it". This
// answers the question after that one: does an actual figure survive the trip.
// It runs the real engine, so what comes out is what the tool would ship.
//
// FM MODE, ONE FIXED DOT SIZE. Rule 5 gives three tone modes and glass can only
// use one of them. AM varies hole diameter, which needs a controllable diameter;
// a scored dot is one spot wide whatever is drawn, so on glass density is the
// only tone carrier there is.
//
// WHY THE PITCH IS SO MUCH FINER THAN THE CAN'S. With size pinned, pitch is the
// only brightness control, and maximum coverage is one spot's area over one hex
// cell: pi*(d/2)^2 / (pitch^2 * sqrt(3)/2). At the can's 1.45mm that is 2.5%
// against the can's own 11.67%, i.e. a quarter of the light, and the presets
// only ask for a fraction of maximum on top of that. Matching the can needs
// about 0.56mm pitch — which is also close to the merge floor of ~2x the spot,
// so the useful window is narrow and worth measuring rather than assuming.
//
// It also emits a lit-polarity preview. Frost is BRIGHT on dark glass, so a
// black-on-white render of the same dots reads as far weaker than the real
// thing and will talk you out of a design that would have worked.
import fs from 'node:fs/promises';
import path from 'node:path';

export default async function ({ run, argv }) {
  const outDir = argv[0] || 'bottle-figure-out';
  const D = Number(argv[1] ?? 60.9);
  const H = Number(argv[2] ?? 84);
  const PITCH = Number(argv[3] ?? 0.6);
  const DOT = 0.2; // one P2S spot

  const out = await run(({ arg }) => {
    const L = window.LAMP;
    const can = { diameterMm: arg.D, heightMm: arg.H, ppm: 8 };
    // One bold motif plus three small accents. Rule 3b's "medium" on an 84mm
    // panel is a third to a half of the wall, so 42mm; the stars are kept well
    // clear of the crescent because a second bright element touching the hero
    // merges with it and neither reads.
    const shapes = [
      { id: 'a', shapeId: 'crescent', xFrac: 0.5, yFrac: 0.5, size: 42, rotation: -20 },
      { id: 'b', shapeId: 'star-5', xFrac: 0.13, yFrac: 0.34, size: 8, rotation: 0 },
      { id: 'c', shapeId: 'star-5', xFrac: 0.76, yFrac: 0.26, size: 9, rotation: 15 },
      { id: 'd', shapeId: 'star-5', xFrac: 0.87, yFrac: 0.63, size: 6, rotation: -10 },
    ];
    const r = L.generate(can, { kind: 'custom', shapes }, {
      pitchMm: arg.PITCH, mode: 'fm', fixedDiameterMm: arg.DOT, jitter: 0.05,
    });
    let area = 0;
    for (const h of r.holes) area += Math.PI * h.r * h.r;
    return {
      W: r.W, H: r.H, n: r.holes.length,
      openPct: +((area / (r.W * r.H)) * 100).toFixed(2),
      holes: r.holes.map((h) => [+h.x.toFixed(2), +h.y.toFixed(2)]),
    };
  }, { D, H, PITCH, DOT });

  await fs.mkdir(outDir, { recursive: true });
  const cut = path.join(outDir, 'figure-test.svg');
  const lit = path.join(outDir, 'figure-test-lit.svg');

  await fs.writeFile(cut, `<?xml version="1.0" encoding="UTF-8"?>
<!-- Dot figure test - Ø${D} x ${H}mm bottle, ${out.W.toFixed(1)}mm wrap.
     Ø${DOT}mm dots at ${PITCH}mm pitch, density-only tone.
     ONE PASS, at the power the dot test settled on. -->
<svg xmlns="http://www.w3.org/2000/svg" width="${out.W.toFixed(3)}mm" height="${out.H.toFixed(3)}mm" viewBox="0 0 ${out.W.toFixed(3)} ${out.H.toFixed(3)}">
<title>Dot figure test — Ø${D} × ${H}mm</title>
<g id="dots" fill="#000000" stroke="none">
${out.holes.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${(DOT / 2).toFixed(2)}"/>`).join('\n')}
</g>
</svg>
`);

  await fs.writeFile(lit, `<svg xmlns="http://www.w3.org/2000/svg" width="${out.W.toFixed(2)}mm" height="${out.H.toFixed(2)}mm" viewBox="0 0 ${out.W.toFixed(2)} ${out.H.toFixed(2)}">
<rect width="100%" height="100%" fill="#2a1608"/>
<g fill="#ffcf90">
${out.holes.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${(DOT * 0.7).toFixed(2)}"/>`).join('')}
</g>
</svg>
`);

  const maxOpen = ((Math.PI * (DOT / 2) ** 2) / ((PITCH * PITCH * Math.sqrt(3)) / 2)) * 100;
  console.log(`wrote ${cut}`);
  console.log(`      ${lit}   (preview only — frost is bright on dark glass)`);
  console.log(`Ø${D} x ${H}mm bottle, ${out.W.toFixed(1)}mm wrap, Ø${DOT}mm dots at ${PITCH}mm pitch`);
  console.log(`${out.n} dots, ${out.openPct}% open (ceiling at this pitch: ${maxOpen.toFixed(2)}%)`);
}
