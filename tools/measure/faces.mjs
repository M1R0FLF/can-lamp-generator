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
// the OUTPUT (rebuilt from the actual holes) and the same band of the SOURCE,
// measured INSIDE THE FACE BOX. 1.0 = that octave survived perfectly.
//
// WHAT IT CAN AND CANNOT DECIDE. It is a FIDELITY measure, so it ranks anything
// that adds information — sample count above all. Measured on one face:
//
//   pitch 0.85  0.942     pitch 1.45  0.923     pitch 2.20  0.863
//
// It cannot choose the identity boost, because a boost is deliberate infidelity:
// boost 0.0 scores 0.950 against boost 1.0's 0.942, i.e. the metric prefers no
// enhancement at all, while boost ~1.0 plainly reads better and boost 2-3 is
// plainly over-cooked. Use this number for pitch, sampler and framing; use your
// eyes for the boost. Writing that down because the earlier whole-frame version
// appeared to endorse the boost and that was an artifact of the flat areas.
//
// Face-local, not whole-frame, and that correction mattered: measured over the
// whole covered band the score is inflated by large flat areas where both
// source and output band sit at ~0, and those matching near-zeros count as
// agreement. A loose crop therefore scored HIGHER than a tight one (0.93 vs
// 0.81) while looking clearly worse. Restricting to the face makes the number
// comparable across framings, which is the whole point of having it.
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

  // the harness page is about:blank, so hand the cascade over as bytes rather
  // than letting loadFaceFinder() fetch a relative URL
  const cascade = (await fs.readFile('public/facefinder')).toString('base64');
  const out = await page.evaluate(async ({ arg }) => {
    const L = window.LAMP;
    if (!L.faceFinderReady()) {
      const bin = atob(arg.cascade);
      const b = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
      await L.loadFaceFinder(URL.createObjectURL(new Blob([b])));
    }
    const D = 65, H = 142, PPM = 8, W = Math.PI * D, SP = 5;
    const can = { diameterMm: D, heightMm: H, ppm: PPM };
    const TUPLE = L.PORTRAIT_STIPPLE;

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

    const ncc = (a, b, mask) => {
      let ma = 0, mb = 0, n = 0;
      for (let i = 0; i < a.length; i++) { if (!mask(i)) continue; ma += a[i]; mb += b[i]; n++; }
      if (!n) return 0;
      ma /= n; mb /= n;
      let num = 0, da = 0, db = 0;
      for (let i = 0; i < a.length; i++) {
        if (!mask(i)) continue;
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
      // adaptive: solve the crop from where the face actually is
      const box = L.findFace(bmp);
      const place = box
        ? L.framingFor(box, bmp.width, bmp.height, ctx.W, ctx.H, PPM, L.DEFAULT_HEAD_HEIGHT_FRAC)
        : L.PORTRAIT_PLACEMENT;
      const src = L.sampleImage(bmp, ctx, place);
      const faceW = box
        ? L.faceWidthOnCan(box, place, bmp.width, bmp.height, ctx.W, ctx.H, PPM)
        : L.faceWidthFor(place, ctx.W, ctx.H);
      const srcBand = bandPass(src.luma, ctx.Wp, ctx.Hp, PPM, faceW);
      // face rect on the canvas, for a framing-invariant comparison region
      const faceMask = (() => {
        const targetW = place.seam === 'fade' ? ctx.Wp * place.coverage : ctx.Wp;
        const scaleFit = Math.max(targetW / bmp.width, ctx.Hp / bmp.height);
        const sc = scaleFit * place.zoom;
        const dw = bmp.width * sc, dh = bmp.height * sc;
        const dx = (ctx.Wp - targetW) / 2 + (targetW - dw) / 2 + place.offsetX * targetW;
        const dy = (ctx.Hp - dh) / 2 - place.offsetY * ctx.Hp;
        const fx0 = dx + (box ? box.x : 0) * sc, fy0 = dy + (box ? box.y : 0) * sc;
        const fx1 = fx0 + (box ? box.w : bmp.width) * sc, fy1 = fy0 + (box ? box.h : bmp.height) * sc;
        return (i) => {
          const x = i % ctx.Wp, y = (i / ctx.Wp) | 0;
          return x >= fx0 && x <= fx1 && y >= fy0 && y <= fy1 && src.cover[i] > 0;
        };
      })();

      const variants = [['portrait', {}]];
      for (const [tag, over] of variants) {
        let field;
        if (!over) {
          const pp = { ...L.DEFAULT_PHOTO_PARAMS,
            gamma: L.solveAutoPunch(bmp, ctx.W, ctx.H, place, L.DEFAULT_PHOTO_PARAMS, TUPLE) };
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
        res.push({ img: im.name, tag, faceW, detected: !!box, score: box ? box.score : 0, holes: s.holes.length,
          open: (area / (ctx.W * ctx.H)) * 100, minWeb,
          bandNCC: ncc(outBand, srcBand, faceMask),
          png: L.renderGlow(paint(s.holes), SP).toDataURL('image/png') });
      }
    }
    return res;
  }, { arg: { imgs, cascade } });

  console.log(`face width on can: ${out[0].faceW.toFixed(1)}mm  ->  identity band = ${(out[0].faceW/16).toFixed(1)}-${(out[0].faceW/8).toFixed(1)}mm features\n`);
  console.log('img'.padEnd(8), 'det'.padStart(4), 'faceMm'.padStart(7), 'holes'.padStart(7), 'open%'.padStart(7), 'minWeb'.padStart(7), 'bandNCC'.padStart(9));
  let last = '';
  for (const r of out) {
    await fs.writeFile(`${outDir}/${r.img}.${r.tag}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
    console.log(r.img.padEnd(8), (r.detected ? 'yes' : 'NO').padStart(4), r.faceW.toFixed(1).padStart(7),
      String(r.holes).padStart(7), r.open.toFixed(2).padStart(7),
      r.minWeb.toFixed(3).padStart(7), r.bandNCC.toFixed(3).padStart(9));
  }
}
