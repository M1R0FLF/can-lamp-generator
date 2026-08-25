// Run real photographs through all three dot patterns and report the numbers
// that decide whether a design is cuttable, plus lit/unlit PNGs to look at.
//
//   node tools/measure/run.mjs tools/measure/photos.mjs <inDir> <outDir> [diameter] [height]
//
// Exists because the synthetic portrait in render.mjs is not a photograph. It
// has smooth gradients, a hard hairline edge and 2-4mm features, which is
// enough to separate the samplers, and it is NOT enough to trust a tone
// pipeline on: it has no noise, no compression artefacts, no skin texture, no
// blown highlights, and its histogram is nothing like a camera's. The two
// things most likely to be wrong on a real face are exactly the two this
// prints: open area against rule 8's 1.8-8% band, and measured min web
// against rule 2's 0.3mm floor.
import fs from 'node:fs/promises';
import path from 'node:path';

const EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);

export default async function ({ run, page, argv }) {
  const inDir = argv[0] || 'test-photos';
  const outDir = argv[1] || 'photo-out';
  const diameter = Number(argv[2] || 65);
  const height = Number(argv[3] || 142);
  await fs.mkdir(outDir, { recursive: true });

  let names;
  try {
    names = (await fs.readdir(inDir)).filter((f) => EXT.has(path.extname(f).toLowerCase())).sort();
  } catch {
    console.error(`can't read ${inDir} — pass the directory holding the photos as the first argument`);
    return;
  }
  if (!names.length) {
    console.error(`no images in ${inDir}`);
    return;
  }
  console.log(`${names.length} image(s) at Ø${diameter}x${height}mm, Standard quality\n`);

  const rows = [];
  for (const name of names) {
    const buf = await fs.readFile(path.join(inDir, name));
    const ext = path.extname(name).toLowerCase().replace('.', '');
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    const dataUrl = `data:image/${mime};base64,${buf.toString('base64')}`;

    const out = await page.evaluate(async ({ arg }) => {
      const L = window.LAMP;
      const { dataUrl, diameter, height } = arg;
      const D = diameter, H = height, PPM = 8, W = Math.PI * D, SP = 6;
      const can = { diameterMm: D, heightMm: H, ppm: PPM };
      // PHOTO_QUALITY, not QUALITY_PRESETS: a loaded photo gets its own ladder
      // (see its comment in photo.ts), and measuring the preset one would be
      // measuring a look no user sees — the same drift this file already
      // records for auto-Punch below.
      const q = L.PHOTO_QUALITY[1];
      const base = { pitchMm: q.pitch, dMin: q.dMin, dMax: q.dMax, jitter: q.jitter };

      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('decode failed'));
        i.src = dataUrl;
      });
      const bmp = await createImageBitmap(img);
      const ctx = L.photoFieldCtx(can);
      const place = L.placementFor(bmp.width, bmp.height, ctx.W, ctx.H);
      const src = L.sampleImage(bmp, ctx, place);
      // Mirror what the app does on load. Leaving this out measures a look no
      // user will ever see — auto-Punch moves gamma by nearly a factor of two
      // between images, so the harness would be reporting the wrong render
      // entirely. (This is the second time this file has drifted from the app;
      // if you add another on-load step, add it here too.)
      const params = {
        ...L.DEFAULT_PHOTO_PARAMS,
        gamma: L.solveAutoPunch(bmp, ctx.W, ctx.H, place, L.DEFAULT_PHOTO_PARAMS, base),
      };

      const paint = (holes, lit) => {
        const c = document.createElement('canvas');
        c.width = Math.round(W * SP);
        c.height = Math.round(H * SP);
        const g = c.getContext('2d');
        g.fillStyle = lit ? '#000' : '#b9bcc0';
        g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = lit ? '#fff' : '#15171a';
        for (const h of holes) {
          g.beginPath();
          g.arc(h.x * SP, h.y * SP, Math.max(0.45, h.r * SP), 0, Math.PI * 2);
          g.fill();
        }
        return c;
      };

      // Fraction of the wall the image actually occupies. A 'fade' medallion
      // covers ~62% of the circumference, so its whole-wall open area is held
      // down by dark metal that was never part of the picture; rule 8's band
      // is about what the eye reads, so the band figure is the one to judge.
      let coverN = 0;
      for (let i = 0; i < src.cover.length; i++) if (src.cover[i] > 0) coverN++;
      const coverFrac = coverN / src.cover.length;

      const shots = [];
      const stats = [];
      for (const [gname, dither] of [['classic', 'hash'], ['smooth', 'blue'], ['detail', 'diffusion']]) {
        const r = L.generate(can, { kind: 'photo', source: src, params }, { ...base, dither });
        const area = r.holes.reduce((a, h) => a + Math.PI * h.r * h.r, 0);
        stats.push({
          gen: gname,
          holes: r.holes.length,
          openPct: (area / (r.W * r.H)) * 100,
          bandOpenPct: (area / (r.W * r.H * coverFrac)) * 100,
          minWeb: r.minWeb,
          cutSeconds: L.estimateCutSeconds(r.holes.length, L.DEFAULT_LASER_SPEED, L.DEFAULT_LASER_PASSES),
        });
        shots.push({ tag: `${gname}.lit`, png: L.renderGlow(paint(r.holes, true), SP).toDataURL('image/png') });
        shots.push({ tag: `${gname}.unlit`, png: paint(r.holes, false).toDataURL('image/png') });
      }
      return { w: bmp.width, h: bmp.height, seam: place.seam, coverage: place.coverage, punch: params.gamma, stats, shots };
    }, { arg: { dataUrl, diameter, height } });

    const stem = path.basename(name, path.extname(name)).replace(/[^a-zA-Z0-9_-]+/g, '-');
    for (const s of out.shots) {
      await fs.writeFile(path.join(outDir, `${stem}.${s.tag}.png`), Buffer.from(s.png.split(',')[1], 'base64'));
    }
    rows.push({ name, ...out });
  }

  // rule 8's band and rule 2's floor are the whole point of the table
  const MIN_OPEN = 1.8, MAX_OPEN = 8, MIN_WEB = 0.3;
  for (const r of rows) {
    console.log(`${r.name}  (${r.w}x${r.h}, placed as ${r.seam}${r.seam === 'fade' ? ` @ ${Math.round(r.coverage * 100)}%` : ''}, auto-Punch ${r.punch})`);
    for (const s of r.stats) {
      const openFlag = s.bandOpenPct < MIN_OPEN ? '  <-- UNDER rule 8 floor' : s.bandOpenPct > MAX_OPEN ? '  <-- OVER rule 8 ceiling' : '';
      const webFlag = s.minWeb < MIN_WEB ? '  <-- UNDER rule 2 floor' : '';
      const hrs = Math.floor(s.cutSeconds / 3600), mins = Math.round((s.cutSeconds % 3600) / 60);
      console.log(
        '  ' + s.gen.padEnd(8),
        String(s.holes).padStart(6) + ' holes',
        (s.openPct.toFixed(2) + '% wall').padStart(12),
        (s.bandOpenPct.toFixed(2) + '% band').padStart(12),
        (s.minWeb.toFixed(3) + 'mm web').padStart(13),
        `~${hrs}h${String(mins).padStart(2, '0')}`.padStart(8),
        openFlag + webFlag
      );
    }
    console.log('');
  }
  console.log(`PNGs in ${outDir}/`);
}
