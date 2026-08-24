// CLAUDE.md's hard requirement: the pattern must wrap seamlessly at x=0/W.
//
// Two new things could break it. The organic grid is a Poisson-disk set that
// has to be periodic in x by construction, not by luck. And the blue-noise
// mask is a 64-wide tile laid over a column count that is not a multiple of
// 64, so its threshold field is discontinuous at the seam.
//
// Checked two ways on a CONSTANT field, where any density variation is an
// artefact rather than the design: hole density in a narrow band straddling
// the seam against the interior, and the closest pair anywhere (computeMinWeb
// wraps, so a seam violation shows up as a short web).
export default async function ({ run }) {
  const out = await run(() => {
    const L = window.LAMP;
    const W = Math.PI * 65, H = 142, PPM = 8;
    const base = { ...L.DEFAULT_STIPPLE, ...L.PHOTO_STIPPLE, pitchMm: 1.45, dMin: 0.28, dMax: 0.52, jitter: 0.15 };
    const gens = [['classic','hex','hash'],['smooth','hex','blue'],['detail','hex','diffusion'],['organic','organic','blue']];
    const res = [];
    for (const [name, grid, dither] of gens) {
      const params = { ...base, grid, dither };
      const r = L.stipple(new Float32Array([0.5]), W, H, 1, 1, PPM, params);
      const BAND = 8; // mm each side of the seam
      let seam = 0, interior = 0;
      for (const h of r.holes) {
        const d = Math.min(h.x, W - h.x); // distance to the seam
        if (d < BAND) seam++;
        else interior++;
      }
      const seamArea = 2 * BAND * H;
      const interiorArea = (W - 2 * BAND) * H;
      const sd = seam / seamArea, id = interior / interiorArea;
      res.push({
        name,
        seamDensity: sd, interiorDensity: id,
        ratio: sd / id,
        minWeb: L.computeMinWeb(r.holes, W, Math.max(r.pitch * 1.2, 0.5)),
        nominal: grid === 'organic' ? params.pitchMm * params.organicPacking - params.dMax : null,
        holes: r.holes.length,
      });
    }
    return res;
  });
  console.log('hole density in an 8mm band each side of the seam vs the interior, on a flat 0.5 field');
  console.log('generator'.padEnd(10), 'seam/mm2'.padStart(9), 'interior'.padStart(9), 'ratio'.padStart(7), 'minWeb'.padStart(8));
  for (const r of out) {
    console.log(r.name.padEnd(10), r.seamDensity.toFixed(4).padStart(9), r.interiorDensity.toFixed(4).padStart(9),
      r.ratio.toFixed(3).padStart(7), r.minWeb.toFixed(4).padStart(8),
      r.nominal != null ? ` (nominal ${r.nominal.toFixed(4)})` : '');
  }
}
