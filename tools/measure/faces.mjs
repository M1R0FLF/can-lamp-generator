// Judge a face render on the band that actually carries identity.
//
//   node tools/measure/run.mjs tools/measure/faces.mjs <outDir> <img...>
//
// The metric every previous attempt was missing. Face identity lives at 8-16
// cycles per face width; every number reported before this averaged straight
// across that band, which is how the metrics stayed happy while the faces were
// unrecognisable.
//
// `bandNCC` is the normalised cross-correlation between the identity band of
// the OUTPUT (rebuilt from the actual holes) and the same band of the SOURCE.
// 1.0 = that octave survived perfectly, 0 = no relationship left.
//
// Correlation, not an energy ratio. The first version of this measured the
// ratio of band energies and produced values of 2-3, i.e. "more identity
// contrast out than in", which is nonsense: the dot pattern's own noise falls
// partly inside the band, so an energy ratio REWARDS noise. That is the same
// trap as every metric before it. Correlation cannot be gamed that way —
// uncorrelated noise pushes it down, not up.
export default async function ({ page, argv }) {
  const fs = await import('node:fs/promises');
  const [outDir, ...files] = argv;
  await fs.mkdir(outDir, { recursive: true });
  const imgs = [];
  for (const f of files) imgs.push({ name: f.split('/').pop().replace(/\..*/, ''), url: 'data:image/jpeg;base64,' + (await fs.readFile(f)).toString('base64') });

  const out = await page.evaluate(async ({ arg }) => {
    const L = window.LAMP;
    const D = 65, H = 142, PPM = 8, W = Math.PI * D, SP = 5;
    const can = { diameterMm: D, heightMm: H, ppm: PPM };
    const TUPLE = L.PORTRAIT_STIPPLE;
    const place = L.PORTRAIT_PLACEMENT;

    const paint = (holes) => {
      const c = document.createElement('canvas');
      c.width = Math.round(W * SP); c.height = Math.round(H * SP);
      const g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#fff';
      for (const h of holes) { g.beginPath(); g.arc(h.x * SP, h.y * SP, Math.max(0.4, h.r * SP), 0, Math.PI * 2); g.fill(); }
      return c;
    };

    // Isolate the identity band: difference of two box blurs at the band edges.
    const bandPass = (fld, Wp, Hp, ppm, faceW) => {
      const rFine = Math.max(1, Math.round((faceW / 16 / 2) * ppm));
      const rCoarse = Math.max(rFine + 1, Math.round((faceW / 8 / 2) * ppm));
      const fine = L.boxBlur(fld, Wp, Hp, rFine, rFine);
      const coarse = L.boxBlur(fld, Wp, Hp, rCoarse, rCoarse);
      const b = new Float32Array(fld.length);
      for (let i = 0; i < fld.length; i++) b[i] = fine[i] - coarse[i];
      return b;
    };

    const ncc = (a, b, cover) => {
      let ma = 0, mb = 0, n = 0;
      for (let i = 0; i < a.length; i++) { if (cover[i] <= 0) continue; ma += a[i]; mb += b[i]; n++; }
      if (!n) return 0;
      ma /= n; mb /= n;
      let num = 0, da = 0, db = 0;
      for (let i = 0; i < a.length; i++) {
        if (cover[i] <= 0) continue;
        const x = a[i] - ma, y = b[i] - mb;
        num += x * y; da += x * x; db += y * y;
      }
      return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
    };

    // What the eye receives: hole area splatted, then blurred to about one
    // cell, which is what the glow and the viewing distance both do. Without
    // this the field is a comb of delta functions and the band-pass reads the
    // comb rather than the picture.
    const openAreaField = (holes, Wp, Hp, ppm, pitch) => {
      const acc = new Float32Array(Wp * Hp);
      for (const h of holes) {
        const x = Math.min(Wp - 1, Math.max(0, Math.round(h.x * ppm)));
        const y = Math.min(Hp - 1, Math.max(0, Math.round(h.y * ppm)));
        acc[y * Wp + x] += Math.PI * h.r * h.r;
      }
      return L.boxBlur(acc, Wp, Hp, Math.max(1, Math.round(pitch * ppm)));
    };

    const res = [];
    for (const im of arg.imgs) {
      const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = im.url; });
      const bmp = await createImageBitmap(img);
      const ctx = L.photoFieldCtx(can);
      const src = L.sampleImage(bmp, ctx, place);
      const faceW = L.faceWidthFor(place, ctx.W, ctx.H);
      const srcBand = bandPass(src.luma, ctx.Wp, ctx.Hp, PPM, faceW);

      const variants = [['portrait', {}]];
      for (const [tag, over] of variants) {
        let field;
        if (!over) {
          const pp = { ...L.DEFAULT_PHOTO_PARAMS,
            gamma: L.solveAutoPunch(bmp, ctx.W, ctx.H, place, L.DEFAULT_PHOTO_PARAMS, TUPLE.pitchMm) };
          field = L.buildPhotoField(src, ctx, pp, TUPLE.pitchMm).field;
        } else {
          const pp = { ...L.DEFAULT_PORTRAIT_PARAMS, faceWidthMm: faceW, ...over };
          field = L.buildPortraitField(src, ctx, pp, TUPLE.pitchMm).field;
        }
        const s = L.stipple(field, ctx.W, ctx.H, ctx.Wp, ctx.Hp, PPM, TUPLE);
        const minWeb = L.computeMinWeb(s.holes, ctx.W, Math.max(s.pitch * 1.2, 0.5));
        const area = s.holes.reduce((a, h) => a + Math.PI * h.r * h.r, 0);
        const rebuilt = openAreaField(s.holes, ctx.Wp, ctx.Hp, PPM, TUPLE.pitchMm);
        const outBand = bandPass(rebuilt, ctx.Wp, ctx.Hp, PPM, faceW);
        res.push({ img: im.name, tag, faceW, holes: s.holes.length,
          open: (area / (ctx.W * ctx.H)) * 100, minWeb,
          bandNCC: ncc(outBand, srcBand, src.cover),
          png: L.renderGlow(paint(s.holes), SP).toDataURL('image/png') });
      }
    }
    return res;
  }, { arg: { imgs } });

  console.log(`face width from framing: ${out[0].faceW.toFixed(1)}mm  ->  identity band = ${(out[0].faceW/16).toFixed(1)}-${(out[0].faceW/8).toFixed(1)}mm features\n`);
  console.log('img'.padEnd(8), 'variant'.padEnd(21), 'holes'.padStart(7), 'open%'.padStart(7), 'minWeb'.padStart(7), 'bandNCC'.padStart(9));
  let last = '';
  for (const r of out) {
    if (r.img !== last) { console.log(''); last = r.img; }
    await fs.writeFile(`${outDir}/${r.img}.${r.tag}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
    console.log(r.img.padEnd(8), r.tag.padEnd(21), String(r.holes).padStart(7), r.open.toFixed(2).padStart(7),
      r.minWeb.toFixed(3).padStart(7), r.bandNCC.toFixed(3).padStart(9));
  }
}
