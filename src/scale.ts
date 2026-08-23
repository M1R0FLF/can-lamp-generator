// Dev harness: render every preset at several diameters at a CONSTANT px/mm,
// so a hero form that grows with the can is immediately obvious (it should
// stay the same physical size; only the count of motifs should change).
import { PRESETS } from './engine/presets';
import { generate } from './engine/generate';
import { renderGlow } from './engine/glow';
import { Hole } from './engine/stipple';

const DIAMETERS = [30, 65, 100];
const SP = 1.9; // px/mm — identical for every cell, that's the whole point
const out = document.getElementById('out')!;
const log = document.getElementById('log')!;

function dots(holes: Hole[], W: number, H: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(W * SP);
  c.height = Math.round(H * SP);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#fff';
  for (const h of holes) {
    ctx.beginPath();
    ctx.arc(h.x * SP, h.y * SP, Math.max(0.4, h.r * SP), 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

const lines: string[] = [];
for (const preset of PRESETS) {
  const row = document.createElement('div');
  row.className = 'row';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = preset.name;
  row.appendChild(name);

  const bits: string[] = [];
  for (const d of DIAMETERS) {
    const r = generate({ diameterMm: d, heightMm: 142, ppm: 6 }, { kind: 'preset', presetId: preset.id });
    const cell = document.createElement('div');
    cell.className = 'cell';
    const lit = renderGlow(dots(r.holes, r.W, r.H), SP);
    cell.appendChild(lit);
    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.textContent = `Ø${d} · ${r.holes.length} holes · web ${r.minWeb.toFixed(2)}`;
    cell.appendChild(cap);
    row.appendChild(cell);
    bits.push(`Ø${d}:${String(r.holes.length).padStart(6)}/web${r.minWeb.toFixed(2)}`);
  }
  out.appendChild(row);
  lines.push(`${preset.name.padEnd(14)} ${bits.join('  ')}`);
  log.textContent = lines.join('\n');
  await new Promise((res) => requestAnimationFrame(() => res(null)));
}
console.log(lines.join('\n'));
