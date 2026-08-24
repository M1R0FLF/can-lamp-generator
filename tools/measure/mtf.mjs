// Modulation transfer of each sampler, plus reconstruction error.
//
// Uniformity on a FLAT field (tools/measure/dither.mjs) turned out not to
// separate the three dithers — they all beat random placement by about the
// same margin. That is the wrong test for a photograph. What separates them is
// how much CONTRAST survives at fine spatial scales, because at ~140 samples
// across a whole picture almost everything interesting is fine.
//
// So: drive the sampler with a sine grating of known frequency, bin the
// resulting holes back into open-area per column, and compare the recovered
// modulation depth against the most any sampler could deliver (the tone
// response applied pointwise). 1.0 means the modulation survived intact.
export default async function ({ run }) {
  const out = await run(() => {
    const L = window.LAMP;
    const D = 65, W = Math.PI * D, H = 142, PPM = 8;
    const Wp = Math.round(W * PPM), Hp = Math.round(H * PPM);
    const base = { ...L.PHOTO_STIPPLE, pitchMm: 1.45, dMin: 0.28, dMax: 0.52, jitter: 0.15 };

    const configs = [
      { name: 'hex+hash', grid: 'hex', dither: 'hash' },
      { name: 'hex+blue', grid: 'hex', dither: 'blue' },
      { name: 'hex+diffusion', grid: 'hex', dither: 'diffusion' },
      { name: 'organic+blue', grid: 'organic', dither: 'blue' },
    ];
    const freqs = [2, 4, 8, 16, 24, 32, 48];

    // interpolated tone response, so "ideal" means "the best this exact
    // sampler config could do", not "the input field"
    const respFn = (resp) => (v) => {
      const s = Math.min(1, Math.max(0, v)) * (resp.open.length - 1);
      const i = Math.min(resp.open.length - 2, Math.floor(s));
      const t = s - i;
      return resp.open[i] * (1 - t) + resp.open[i + 1] * t;
    };

    // amplitude of the f-th harmonic of a real profile
    const harmonic = (arr, f) => {
      let re = 0, im = 0;
      for (let i = 0; i < arr.length; i++) {
        const a = (2 * Math.PI * f * (i + 0.5)) / arr.length;
        re += arr[i] * Math.cos(a);
        im -= arr[i] * Math.sin(a);
      }
      return (2 * Math.sqrt(re * re + im * im)) / arr.length;
    };

    const NB = 141; // analysis bins ~= one pitch wide
    const res = [];
    for (const c of configs) {
      const params = { ...base, grid: c.grid, dither: c.dither };
      const resp = L.measureResponse(params, W, H, PPM);
      const R = respFn(resp);
      const mtf = [];
      for (const f of freqs) {
        const field = new Float32Array(Wp * Hp);
        const ideal = new Float64Array(NB);
        for (let col = 0; col < Wp; col++) {
          const x = (col + 0.5) / PPM;
          const v = 0.5 + 0.4 * Math.sin((2 * Math.PI * f * x) / W);
          for (let row = 0; row < Hp; row++) field[row * Wp + col] = v;
        }
        for (let b = 0; b < NB; b++) {
          const x = ((b + 0.5) / NB) * W;
          ideal[b] = R(0.5 + 0.4 * Math.sin((2 * Math.PI * f * x) / W));
        }
        const r = L.stipple(field, W, H, Wp, Hp, PPM, params);
        const got = new Float64Array(NB);
        for (const h of r.holes) {
          const b = Math.min(NB - 1, Math.floor((h.x / W) * NB));
          got[b] += Math.PI * h.r * h.r;
        }
        const binArea = (W / NB) * H;
        for (let b = 0; b < NB; b++) got[b] /= binArea;
        mtf.push(harmonic(ideal, f) > 1e-9 ? harmonic(got, f) / harmonic(ideal, f) : 0);
      }

      // reconstruction error on a blobby "natural" field, judged at the scale
      // the eye integrates from across a room (~4mm on a 65mm can)
      const field = new Float32Array(Wp * Hp);
      const blobs = [];
      let s = 12345;
      const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      for (let i = 0; i < 14; i++) blobs.push([rnd() * W, rnd() * H, 8 + rnd() * 26, 0.35 + rnd() * 0.65]);
      for (let row = 0; row < Hp; row++) {
        const y = H - (row + 0.5) / PPM;
        for (let col = 0; col < Wp; col++) {
          const x = (col + 0.5) / PPM;
          let v = 0.05;
          for (const [bx, by, br, ba] of blobs) {
            let dx = x - bx;
            if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W;
            const d2 = (dx * dx + (y - by) * (y - by)) / (br * br);
            v = Math.max(v, ba * Math.exp(-d2));
          }
          field[row * Wp + col] = Math.min(1, v);
        }
      }
      const r = L.stipple(field, W, H, Wp, Hp, PPM, params);
      const AC = 4; // analysis cell, mm
      const nx = Math.floor(W / AC), ny = Math.floor(H / AC);
      const got = new Float64Array(nx * ny), want = new Float64Array(nx * ny), cnt = new Float64Array(nx * ny);
      for (const h of r.holes) {
        const bx = Math.min(nx - 1, Math.floor((h.x / W) * nx));
        const by = Math.min(ny - 1, Math.floor((h.y / H) * ny));
        got[by * nx + bx] += Math.PI * h.r * h.r;
      }
      for (let row = 0; row < Hp; row++) {
        const yMm = H - (row + 0.5) / PPM;
        const by = Math.min(ny - 1, Math.max(0, Math.floor((yMm / H) * ny)));
        for (let col = 0; col < Wp; col++) {
          const bx = Math.min(nx - 1, Math.floor(((col + 0.5) / PPM / W) * nx));
          want[by * nx + bx] += R(field[row * Wp + col]);
          cnt[by * nx + bx]++;
        }
      }
      const cellArea = AC * AC;
      let se = 0, n = 0;
      for (let i = 0; i < got.length; i++) {
        if (cnt[i] === 0) continue;
        const g = got[i] / cellArea, w = want[i] / cnt[i];
        se += (g - w) * (g - w);
        n++;
      }
      res.push({
        name: c.name,
        mtf,
        rms: Math.sqrt(se / n) / resp.maxOpen, // as a fraction of full scale
        holes: r.holes.length,
      });
    }
    return { freqs, res };
  });

  console.log('modulation transfer (1.00 = modulation fully preserved; Nyquist ~= 70 cyc/circumference)');
  console.log('config'.padEnd(15), ...out.freqs.map((f) => `${f}c`.padStart(7)));
  for (const r of out.res) {
    console.log(r.name.padEnd(15), ...r.mtf.map((m) => m.toFixed(3).padStart(7)));
  }
  console.log('\nreconstruction RMS error on a blobby field, judged in 4mm cells (fraction of full scale):');
  for (const r of out.res) console.log(' ', r.name.padEnd(15), (r.rms * 100).toFixed(2) + '%', ' holes', r.holes);
}
