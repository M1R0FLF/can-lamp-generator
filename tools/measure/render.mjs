// Render real PNGs so a human can judge the things no metric catches
// (CLAUDE.md rule 8: "generate the preset, look at the flat unlit/lit render").
//
//   node tools/measure/run.mjs tools/measure/render.mjs <outDir>
import fs from 'node:fs/promises';
import path from 'node:path';

export default async function ({ run, argv }) {
  const outDir = argv[0] || 'render-out';
  await fs.mkdir(outDir, { recursive: true });

  const shots = await run(async () => {
    const L = window.LAMP;
    const D = 65, H = 142, PPM = 8;
    const W = Math.PI * D;
    const SP = 6; // preview px per mm

    // ---- synthetic test material ----
    // A chart, not a photo: each band targets one failure mode the generators
    // are supposed to differ on, so the difference is legible side by side
    // instead of being buried in a picture.
    const chart = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(W * 8); c.height = Math.round(H * 8);
      const g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
      const px = (mm) => mm * 8;
      // 1. smooth horizontal ramp - banding and mottling
      const ramp = g.createLinearGradient(0, 0, c.width, 0);
      ramp.addColorStop(0, '#000'); ramp.addColorStop(1, '#fff');
      g.fillStyle = ramp; g.fillRect(0, 0, c.width, px(30));
      // 2. flat mid-tone patches - dot chaining / worms
      for (let i = 0; i < 5; i++) {
        const v = Math.round(255 * (0.25 + i * 0.13));
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(px(6 + i * 38), px(34), px(34), px(26));
      }
      // 3. vertical stripe pack at shrinking period - moire and MTF
      for (let k = 0; k < 4; k++) {
        const period = [10, 6, 4, 2.6][k];
        const x0 = px(6 + k * 48);
        for (let x = 0; x < px(44); x += px(period)) {
          g.fillStyle = '#fff';
          g.fillRect(x0 + x, px(64), px(period / 2), px(24));
        }
      }
      // 4. shaded sphere - continuous tone on a curved form
      const sph = g.createRadialGradient(px(40), px(112), px(2), px(46), px(118), px(26));
      sph.addColorStop(0, '#fff'); sph.addColorStop(1, '#111');
      g.fillStyle = sph;
      g.beginPath(); g.arc(px(46), px(114), px(24), 0, Math.PI * 2); g.fill();
      // 5. fine detail: concentric rings and thin bars at 1-4mm
      for (let r = 2; r < 24; r += 3) {
        g.strokeStyle = '#fff'; g.lineWidth = px(1.2);
        g.beginPath(); g.arc(px(120), px(114), px(r), 0, Math.PI * 2); g.stroke();
      }
      for (let i = 0; i < 8; i++) {
        g.fillStyle = '#fff';
        g.fillRect(px(160 + i * 4.5), px(94), px(1.4), px(40));
      }
      return c;
    };

    // A shaded head-and-shoulders form: large smooth gradient, a hard hairline
    // edge, small high-contrast features, and a textured ground. Stands in for
    // "does a subject still read" without needing a real photograph.
    const portrait = () => {
      const c = document.createElement('canvas');
      c.width = 900; c.height = 1200;
      const g = c.getContext('2d');
      const bg = g.createLinearGradient(0, 0, 0, c.height);
      bg.addColorStop(0, '#2a2a2a'); bg.addColorStop(1, '#0a0a0a');
      g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
      // ground texture, so a self-guided filter has variance to work with
      for (let i = 0; i < 5000; i++) {
        const x = Math.random() * c.width, y = Math.random() * c.height;
        const v = 30 + Math.random() * 50;
        g.fillStyle = `rgba(${v},${v},${v},0.35)`;
        g.beginPath(); g.arc(x, y, 2 + Math.random() * 9, 0, Math.PI * 2); g.fill();
      }
      // shoulders
      g.fillStyle = '#3a3a3a';
      g.beginPath(); g.ellipse(450, 1180, 400, 260, 0, 0, Math.PI * 2); g.fill();
      // head, lit from upper left
      const skin = g.createRadialGradient(360, 480, 20, 450, 620, 400);
      skin.addColorStop(0, '#f2f2f2'); skin.addColorStop(0.55, '#b8b8b8'); skin.addColorStop(1, '#3c3c3c');
      g.fillStyle = skin;
      g.beginPath(); g.ellipse(450, 620, 250, 320, 0, 0, Math.PI * 2); g.fill();
      // hair: a hard, high-contrast edge across the top of the gradient
      g.fillStyle = '#101010';
      g.beginPath(); g.ellipse(450, 400, 265, 210, 0, Math.PI, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(450, 430, 275, 250, 0, Math.PI * 1.05, Math.PI * 1.95); g.fill();
      // eyes, brows, nose shadow, mouth - the fine detail that must survive
      for (const ex of [355, 545]) {
        g.fillStyle = '#f8f8f8';
        g.beginPath(); g.ellipse(ex, 570, 42, 24, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#111';
        g.beginPath(); g.arc(ex, 572, 17, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#1a1a1a'; g.lineWidth = 13;
        g.beginPath(); g.moveTo(ex - 48, 522); g.quadraticCurveTo(ex, 505, ex + 48, 524); g.stroke();
      }
      g.strokeStyle = 'rgba(20,20,20,0.55)'; g.lineWidth = 16;
      g.beginPath(); g.moveTo(450, 600); g.lineTo(438, 700); g.stroke();
      g.strokeStyle = '#1d1d1d'; g.lineWidth = 15;
      g.beginPath(); g.moveTo(390, 780); g.quadraticCurveTo(450, 812, 512, 778); g.stroke();
      return c;
    };

    const dotsCanvas = (holes, notch) => {
      const c = document.createElement('canvas');
      c.width = Math.round(W * SP); c.height = Math.round(H * SP);
      const g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#fff';
      for (const h of holes) {
        g.beginPath();
        g.arc(h.x * SP, h.y * SP, Math.max(0.45, h.r * SP), 0, Math.PI * 2);
        g.fill();
      }
      return c;
    };
    const unlitCanvas = (holes) => {
      const c = document.createElement('canvas');
      c.width = Math.round(W * SP); c.height = Math.round(H * SP);
      const g = c.getContext('2d');
      g.fillStyle = '#b9bcc0'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#15171a';
      for (const h of holes) {
        g.beginPath();
        g.arc(h.x * SP, h.y * SP, Math.max(0.45, h.r * SP), 0, Math.PI * 2);
        g.fill();
      }
      return c;
    };

    const GENS = [
      ['classic', { grid: 'hex', dither: 'hash' }],
      ['smooth', { grid: 'hex', dither: 'blue' }],
      ['detail', { grid: 'hex', dither: 'diffusion' }],
      ['organic', { grid: 'organic', dither: 'blue' }],
    ];
    const q = window.LAMP.QUALITY_PRESETS[1];
    const base = { pitchMm: q.pitch, dMin: q.dMin, dMax: q.dMax, jitter: q.jitter };
    const can = { diameterMm: D, heightMm: H, ppm: PPM };
    const shots = [];

    const emit = (name, holes) => {
      shots.push({ name: name + '.lit', png: L.renderGlow(dotsCanvas(holes), SP).toDataURL('image/png') });
      shots.push({ name: name + '.unlit', png: unlitCanvas(holes).toDataURL('image/png') });
    };

    // --- photo sources through each generator ---
    const mk = async (canvasFactory, label, extraParams) => {
      const bmp = await createImageBitmap(canvasFactory());
      const ctx = L.photoFieldCtx(can);
      const place = L.placementFor(bmp.width, bmp.height, ctx.W, ctx.H);
      const src = L.sampleImage(bmp, ctx, place);
      for (const [gname, g] of GENS) {
        const r = L.generate(can, { kind: 'photo', source: src, params: { ...L.DEFAULT_PHOTO_PARAMS, ...extraParams } }, { ...base, ...g });
        emit(`${label}-${gname}`, r.holes);
        shots[shots.length - 1].stats = { holes: r.holes.length, minWeb: r.minWeb, open: r.holes.reduce((a, h) => a + Math.PI * h.r * h.r, 0) / (r.W * r.H) };
      }
    };
    await mk(chart, 'chart', {});
    await mk(portrait, 'portrait', {});
    // local-contrast reference comparison, on the portrait only
    for (const [tag, ea] of [['boxblur', false], ['guided', true]]) {
      const bmp = await createImageBitmap(portrait());
      const ctx = L.photoFieldCtx(can);
      const place = L.placementFor(bmp.width, bmp.height, ctx.W, ctx.H);
      const src = L.sampleImage(bmp, ctx, place);
      const r = L.generate(can, { kind: 'photo', source: src, params: { ...L.DEFAULT_PHOTO_PARAMS, localContrastEdgeAware: ea } }, { ...base, grid: 'hex', dither: 'diffusion' });
      emit(`lc-${tag}`, r.holes);
    }
    // --- a preset through each generator, to check nothing tuned breaks ---
    for (const pid of ['eclipse', 'escarcha']) {
      for (const [gname, g] of GENS) {
        const r = L.generate(can, { kind: 'preset', presetId: pid }, { ...base, ...g });
        emit(`${pid}-${gname}`, r.holes);
      }
    }
    return shots;
  });

  for (const s of shots) {
    const b64 = s.png.split(',')[1];
    await fs.writeFile(path.join(outDir, s.name + '.png'), Buffer.from(b64, 'base64'));
  }
  console.log(`wrote ${shots.length} PNGs to ${outDir}`);
}
