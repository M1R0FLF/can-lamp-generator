// Can this actually be cut? Geometric min web is only one of the checks, and
// halving the pitch for portraits changes several of the others.
//
//   node tools/measure/run.mjs tools/measure/laserability.mjs <imageFile>
//
// What each column is, and why it is here:
//
//   minWeb        edge-to-edge metal between the closest pair of holes. The
//                 check that already existed.
//   web@tol       the same figure after allowing for POSITIONAL error. A rotary
//                 axis has runout and backlash; two neighbouring holes can each
//                 drift toward the other, so the real web is minWeb - 2*tol.
//                 This is the number that decides whether webs tear, and
//                 nothing was checking it.
//   slenderness   web width / wall thickness (0.1mm). A 0.30mm web on 0.1mm
//                 foil is a 3:1 ligament; thinner gets fragile to handle, not
//                 just to cut.
//   smallest Ø    the smallest hole the design actually asks for. Below some
//                 diameter a hole will not reliably penetrate 0.1mm aluminium,
//                 and an unpenetrated hole passes NO light - so the dark end of
//                 the tone range silently stops existing. That threshold is
//                 machine-specific and UNKNOWN for this setup; see
//                 tools/measure/calibration-tile.mjs.
//   holes/cm2     heat input proxy. Same total energy packed into a smaller
//                 area means more chance of adjacent cuts bridging.
const WALL_MM = 0.1;
const WEB_FLOOR = 0.3;

export default async function ({ page, argv }) {
  const fs = await import('node:fs/promises');
  const file = argv[0];
  const dataUrl = 'data:image/jpeg;base64,' + (await fs.readFile(file)).toString('base64');
  const out = await page.evaluate(async ({ arg }) => {
    const L = window.LAMP;
    const D = 65, H = 142, PPM = 8, W = Math.PI * D;
    const can = { diameterMm: D, heightMm: H, ppm: PPM };
    const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = arg.dataUrl; });
    const bmp = await createImageBitmap(img);
    const place = { seam: 'fade', coverage: 0.55, zoom: 1.35, offsetX: 0, offsetY: 0.06, fit: 'cover' };
    const tuples = [
      { tag: 'shipped 1.45', pitchMm: 1.45, dMin: 0.28, dMax: 0.52, jitter: 0.15 },
      { tag: 'ultra 0.98',   pitchMm: 0.98, dMin: 0.20, dMax: 0.40, jitter: 0.05 },
      { tag: 'cand 0.85',    pitchMm: 0.85, dMin: 0.18, dMax: 0.36, jitter: 0.05 },
      { tag: 'cand 0.75',    pitchMm: 0.75, dMin: 0.16, dMax: 0.32, jitter: 0.04 },
      { tag: 'cand 0.65',    pitchMm: 0.65, dMin: 0.14, dMax: 0.30, jitter: 0.03 },
    ];
    const res = [];
    for (const t of tuples) {
      const st = { pitchMm: t.pitchMm, dMin: t.dMin, dMax: t.dMax, jitter: t.jitter, dither: 'diffusion' };
      const ctx = L.photoFieldCtx(can);
      const src = L.sampleImage(bmp, ctx, place);
      const params = { ...L.DEFAULT_PHOTO_PARAMS,
        gamma: L.solveAutoPunch(bmp, ctx.W, ctx.H, place, L.DEFAULT_PHOTO_PARAMS, st) };
      const r = L.generate(can, { kind: 'photo', source: src, params }, st);
      let smallest = Infinity, area = 0;
      const hist = {};
      for (const h of r.holes) {
        const d = h.r * 2;
        if (d < smallest) smallest = d;
        area += Math.PI * h.r * h.r;
        const b = (Math.floor(d / 0.02) * 0.02).toFixed(2);
        hist[b] = (hist[b] || 0) + 1;
      }
      // occupied area: holes only exist where the image is, so density is
      // measured over the covered band rather than the whole wall
      const bandMm2 = W * place.coverage * H;
      res.push({ tag: t.tag, pitch: t.pitchMm, dMinSpec: t.dMin, holes: r.holes.length,
        minWeb: r.minWeb, smallest, open: (area / (r.W * r.H)) * 100,
        perCm2: r.holes.length / (bandMm2 / 100),
        cutH: L.estimateCutSeconds(r.holes.length, 10, 5) / 3600, hist });
    }
    return res;
  }, { arg: { dataUrl } });

  const TOLS = [0.03, 0.05, 0.08];
  console.log(`wall ${WALL_MM}mm, web floor ${WEB_FLOOR}mm\n`);
  console.log('tuple'.padEnd(13), 'holes'.padStart(7), 'minWeb'.padStart(7),
    ...TOLS.map((t) => `web@±${t}`.padStart(9)), 'slender'.padStart(8), 'small Ø'.padStart(8), 'h/cm²'.padStart(7), 'cut'.padStart(6));
  for (const r of out) {
    const cells = TOLS.map((t) => {
      const w = r.minWeb - 2 * t;
      return ((w < WEB_FLOOR ? '!' : ' ') + w.toFixed(3)).padStart(9);
    });
    console.log(r.tag.padEnd(13), String(r.holes).padStart(7), r.minWeb.toFixed(3).padStart(7),
      ...cells, (r.minWeb / WALL_MM).toFixed(1).padStart(8),
      r.smallest.toFixed(3).padStart(8), r.perCm2.toFixed(0).padStart(7), (r.cutH.toFixed(1) + 'h').padStart(6));
  }
  console.log('\n"!" = falls below the 0.3mm web floor once positional error is allowed for.');
  console.log('\nhole-diameter distribution (mm bucket : count) — the small end is the unverified risk:');
  for (const r of out) {
    const ks = Object.keys(r.hist).sort();
    console.log(' ', r.tag.padEnd(13), ks.slice(0, 5).map((k) => `${k}:${r.hist[k]}`).join('  '));
  }
}
