// Baseline: every preset at Standard quality on a Ø65x142mm can, plus the
// sampler's open-area response curve. Run before and after any engine change;
// presets must come out bit-identical.
export default async function ({ run }) {
  const rows = await run(() => {
    const L = window.LAMP;
    const can = { diameterMm: 65, heightMm: 142, ppm: 8 };
    const q = L.QUALITY_PRESETS[L.DEFAULT_QUALITY_INDEX];
    const over = { pitchMm: q.pitch, dMin: q.dMin, dMax: q.dMax, jitter: q.jitter };
    const out = [];
    for (const p of L.PRESETS) {
      const r = L.generate(can, { kind: 'preset', presetId: p.id }, over);
      let area = 0;
      for (const h of r.holes) area += Math.PI * h.r * h.r;
      // a cheap order-independent checksum, so "bit-identical" is one number
      let sum = 0;
      for (const h of r.holes) sum = (sum + Math.round(h.x * 1e4) + Math.round(h.y * 1e4) * 3 + Math.round(h.r * 1e6) * 7) % 2147483647;
      out.push({
        id: p.id,
        holes: r.holes.length,
        minWeb: +r.minWeb.toFixed(4),
        openPct: +((area / (r.W * r.H)) * 100).toFixed(3),
        checksum: sum,
      });
    }
    return out;
  });

  console.log('preset'.padEnd(16), 'holes'.padStart(7), 'minWeb'.padStart(8), 'open%'.padStart(7), 'checksum'.padStart(11));
  for (const r of rows) {
    console.log(r.id.padEnd(16), String(r.holes).padStart(7), r.minWeb.toFixed(4).padStart(8), r.openPct.toFixed(2).padStart(7), String(r.checksum).padStart(11));
  }

  const resp = await run(() => {
    const L = window.LAMP;
    const W = Math.PI * 65, H = 142, PPM = 8;
    const measure = (params) => {
      const curve = [];
      for (let k = 0; k <= 16; k++) {
        const v = k / 16;
        // 1x1 field: stipple() clamps px/py into range, so every cell reads v
        const r = L.stipple(new Float32Array([v]), W, H, 1, 1, PPM, params);
        let area = 0;
        for (const h of r.holes) area += Math.PI * h.r * h.r;
        curve.push(+(area / (W * H)).toFixed(5));
      }
      return curve;
    };
    return {
      photo: measure({ ...L.PHOTO_STIPPLE, pitchMm: 1.45, dMin: 0.28, dMax: 0.52, jitter: 0.15 }),
      preset: measure({ pitchMm: 1.45, dMin: 0.28, dMax: 0.52, jitter: 0.15 }),
    };
  });
  console.log('\nopen-area response (tone 0..1 in 1/16 steps), as fraction of canvas:');
  for (const [k, v] of Object.entries(resp)) console.log(' ', k.padEnd(7), v.join(' '));
}
