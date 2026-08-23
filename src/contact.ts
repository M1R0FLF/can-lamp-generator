// Dev harness: render every preset side by side so weak ones are obvious.
// Not part of the shipped UI.
import { PRESETS } from './engine/presets';
import { generate } from './engine/generate';
import { renderGlow } from './engine/glow';
import { Hole } from './engine/stipple';

const SP = 3.4; // px/mm preview scale
const grid = document.getElementById('grid')!;
const log = document.getElementById('log')!;

function dotsCanvas(holes: Hole[], W: number, H: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(W * SP);
  c.height = Math.round(H * SP);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#fff';
  for (const h of holes) {
    ctx.beginPath();
    ctx.arc(h.x * SP, h.y * SP, Math.max(0.45, h.r * SP), 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/** Coverage stats tell us whether a design has real blacks (rule 5/7). */
function toneStats(field: Float32Array, thresh: number) {
  let black = 0;
  let bright = 0;
  for (let i = 0; i < field.length; i++) {
    if (field[i] <= thresh) black++;
    if (field[i] > 0.75) bright++;
  }
  return {
    blackPct: (100 * black) / field.length,
    brightPct: (100 * bright) / field.length,
  };
}

const lines: string[] = [];
for (const preset of PRESETS) {
  const t0 = performance.now();
  const r = generate({ diameterMm: 65, heightMm: 142, ppm: 6 }, { kind: 'preset', presetId: preset.id });
  const total = performance.now() - t0;
  const stats = toneStats(r.field, r.stipple.thresh);

  const fig = document.createElement('figure');
  const dots = dotsCanvas(r.holes, r.W, r.H);
  const lit = renderGlow(dots, SP);
  lit.style.width = '100%';
  fig.appendChild(lit);
  const cap = document.createElement('figcaption');
  cap.innerHTML =
    `<b>${preset.name}</b> · ${preset.group} · ${r.holes.length.toLocaleString()} holes · ` +
    `pitch ${r.pitch.toFixed(2)} · minweb ${r.minWeb.toFixed(3)}mm · ` +
    `black ${stats.blackPct.toFixed(0)}% · bright ${stats.brightPct.toFixed(0)}% · ` +
    `${total.toFixed(0)}ms<br>${preset.description}`;
  fig.appendChild(cap);
  grid.appendChild(fig);

  lines.push(
    `${preset.name.padEnd(14)} holes=${String(r.holes.length).padStart(6)} minweb=${r.minWeb.toFixed(3)} ` +
      `black=${stats.blackPct.toFixed(0)}% bright=${stats.brightPct.toFixed(0)}% ` +
      `build=${r.buildMs.toFixed(0)}ms sample=${r.sampleMs.toFixed(0)}ms`
  );
  log.textContent = lines.join('\n');
  await new Promise((res) => requestAnimationFrame(() => res(null)));
}

(window as any).__contactStats = lines;
console.log(lines.join('\n'));
