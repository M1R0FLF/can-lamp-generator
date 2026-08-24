// Compare the three density dithers on the two things that matter:
//   1. TONE FIDELITY  - does the delivered open area match what was asked for?
//   2. UNIFORMITY     - is a flat tone flat, or does it mottle? (rule 5)
//
// Uniformity is measured as the coefficient of variation of hole counts over
// ~5x5-cell windows, normalised against the binomial CoV that pure random
// placement would give. Below 1.0 means better-than-random spatial
// distribution, i.e. actually blue. Above 1.0 means clumping.
export default async function ({ run }) {
  const out = await run(() => {
    const L = window.LAMP;
    const W = Math.PI * 65, H = 142, PPM = 8;
    const base = { ...L.PHOTO_STIPPLE, pitchMm: 1.45, dMin: 0.28, dMax: 0.52, jitter: 0.15 };

    const uniformity = (holes, pitch, win = 5) => {
      const cw = pitch * win, chh = pitch * win;
      const nx = Math.max(2, Math.floor(W / cw)), ny = Math.max(2, Math.floor(H / chh));
      const bins = new Int32Array(nx * ny);
      for (const h of holes) {
        const bx = Math.min(nx - 1, Math.floor((h.x / W) * nx));
        const by = Math.min(ny - 1, Math.floor((h.y / H) * ny));
        bins[by * nx + bx]++;
      }
      const n = bins.length;
      let mean = 0;
      for (const b of bins) mean += b;
      mean /= n;
      if (mean <= 0) return null;
      let v = 0;
      for (const b of bins) v += (b - mean) * (b - mean);
      v /= n;
      const cov = Math.sqrt(v) / mean;
      // cells per window, and the placement probability that produced `mean`
      const cells = win * win * (2 / Math.sqrt(3));
      const pOn = Math.min(1, mean / cells);
      const binomCov = pOn >= 1 ? 1e-9 : Math.sqrt(cells * pOn * (1 - pOn)) / mean;
      return { cov, ratio: cov / binomCov };
    };

    const configs = [
      { name: 'hex+hash', grid: 'hex', dither: 'hash' },
      { name: 'hex+blue', grid: 'hex', dither: 'blue' },
      { name: 'hex+diffusion', grid: 'hex', dither: 'diffusion' },
      { name: 'organic+blue', grid: 'organic', dither: 'blue' },
    ];
    const tones = [0.15, 0.3, 0.5, 0.7];
    const res = [];
    for (const c of configs) {
      const params = { ...base, grid: c.grid, dither: c.dither };
      const resp = L.measureResponse(params, W, H, PPM);
      const row = { name: c.name, maxOpen: resp.maxOpen, tones: [] };
      for (const t of tones) {
        const r = L.stipple(new Float32Array([t]), W, H, 1, 1, PPM, params);
        const u = uniformity(r.holes, r.pitch);
        // requested open area, if the response were perfectly linear in tone
        row.tones.push({ t, holes: r.holes.length, ...u });
      }
      // min web on a real mid-tone field, and hole count on a full-tone field
      const full = L.stipple(new Float32Array([1]), W, H, 1, 1, PPM, params);
      row.minWebFull = L.computeMinWeb(full.holes, W, Math.max(full.pitch * 1.2, 0.5));
      row.fullHoles = full.holes.length;
      res.push(row);
    }
    return res;
  });

  console.log('config'.padEnd(15), 'maxOpen%'.padStart(9), 'fullHoles'.padStart(10), 'minWeb'.padStart(8));
  for (const r of out) {
    console.log(r.name.padEnd(15), (r.maxOpen * 100).toFixed(2).padStart(9), String(r.fullHoles).padStart(10), r.minWebFull.toFixed(4).padStart(8));
  }
  console.log('\nuniformity (CoV of hole counts over 5x5-cell windows; ratio vs random placement)');
  console.log('config'.padEnd(15), ...[0.15, 0.3, 0.5, 0.7].map((t) => `t=${t}`.padStart(16)));
  for (const r of out) {
    console.log(r.name.padEnd(15), ...r.tones.map((x) => `${x.cov.toFixed(3)} (${x.ratio.toFixed(2)}x)`.padStart(16)));
  }
}
