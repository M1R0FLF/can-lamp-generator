// Draw the detected face box over every source image, so the detector is judged
// by looking at it rather than by a confidence number it computed itself.
export default async function ({ page, argv }) {
  const fs = await import('node:fs/promises');
  const [outDir, ...files] = argv;
  await fs.mkdir(outDir, { recursive: true });
  const imgs = [];
  for (const f of files) imgs.push({ name: f.split('/').pop().replace(/\..*/, ''), url: 'data:image/jpeg;base64,' + (await fs.readFile(f)).toString('base64') });
  const out = await page.evaluate(async ({ arg }) => {
    const L = window.LAMP;
    const res = [];
    for (const im of arg.imgs) {
      const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = im.url; });
      const bmp = await createImageBitmap(img);
      const t0 = performance.now();
      const box = L.findFace(bmp);
      const ms = performance.now() - t0;
      const S = 300;
      const c = document.createElement('canvas');
      c.width = S; c.height = S;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      const s = Math.min(S / bmp.width, S / bmp.height);
      g.drawImage(img, 0, 0, bmp.width * s, bmp.height * s);
      if (box) {
        g.strokeStyle = box.confidence >= 0.9 ? '#39d353' : box.confidence >= 0.6 ? '#f0b64b' : '#f85149';
        g.lineWidth = 3;
        g.strokeRect(box.x * s, box.y * s, box.w * s, box.h * s);
      }
      res.push({ name: im.name, box, ms, png: c.toDataURL('image/jpeg', 0.9) });
    }
    return res;
  }, { arg: { imgs } });
  console.log('img'.padEnd(8), 'conf'.padStart(5), 'x'.padStart(6), 'y'.padStart(6), 'w'.padStart(6), 'h'.padStart(6), 'h/w'.padStart(5), 'ms'.padStart(5));
  for (const r of out) {
    await fs.writeFile(`${outDir}/${r.name}.box.jpg`, Buffer.from(r.png.split(',')[1], 'base64'));
    if (!r.box) { console.log(r.name.padEnd(8), 'NONE'); continue; }
    const b = r.box;
    console.log(r.name.padEnd(8), b.confidence.toFixed(2).padStart(5), b.x.toFixed(0).padStart(6), b.y.toFixed(0).padStart(6),
      b.w.toFixed(0).padStart(6), b.h.toFixed(0).padStart(6), (b.h / b.w).toFixed(2).padStart(5), r.ms.toFixed(0).padStart(5));
  }
}
