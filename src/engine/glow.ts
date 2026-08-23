// Port of the reference generator's glow() backlight compositor: three
// Gaussian blur radii layered with a warm color curve. Sigma values are
// tuned for the reference's SP=7 px/mm preview scale; we rescale them to
// whatever render scale is actually in use.
const REF_SP = 7;
const SIGMAS = [1.6, 9.0, 30.0];
const SIGMA_WEIGHTS = [0.75, 0.85, 1.5];

function blurCopy(src: HTMLCanvasElement, blurPx: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d')!;
  ctx.filter = blurPx > 0 ? `blur(${blurPx}px)` : 'none';
  ctx.drawImage(src, 0, 0);
  return out;
}

export function renderGlow(dotsCanvas: HTMLCanvasElement, spPxPerMm: number): HTMLCanvasElement {
  const { width, height } = dotsCanvas;
  const scale = spPxPerMm / REF_SP;
  const baseCtx = dotsCanvas.getContext('2d')!;
  const a = baseCtx.getImageData(0, 0, width, height).data;

  const blurs = SIGMAS.map((s) => {
    const c = blurCopy(dotsCanvas, s * scale);
    return c.getContext('2d')!.getImageData(0, 0, width, height).data;
  });

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const outCtx = out.getContext('2d')!;
  const outImg = outCtx.createImageData(width, height);

  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const av = a[i] / 255;
    let L = av;
    for (let k = 0; k < 3; k++) L += (blurs[k][i] / 255) * SIGMA_WEIGHTS[k];
    L = Math.min(L, 1.6);

    const R = Math.pow(Math.min(Math.max(L * 1.3, 0), 1), 0.8);
    const G = Math.pow(Math.min(Math.max(L * 0.86, 0), 1), 1.02);
    const B = Math.pow(Math.min(Math.max(L * 0.42, 0), 1), 1.45);

    outImg.data[i] = Math.round(Math.min(Math.max(R * 0.97 + 0.03 * 0.06, 0), 1) * 255);
    outImg.data[i + 1] = Math.round(Math.min(Math.max(G * 0.97 + 0.03 * 0.05, 0), 1) * 255);
    outImg.data[i + 2] = Math.round(Math.min(Math.max(B * 0.97 + 0.03 * 0.06, 0), 1) * 255);
    outImg.data[i + 3] = 255;
  }
  outCtx.putImageData(outImg, 0, 0);
  return out;
}
