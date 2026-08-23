// Measures the true minimum web (edge-to-edge gap between nearest hole
// pairs) from the generated holes, per CLAUDE.md rule 2: with jitter, the
// nominal pitch-d_max bound degrades and must be checked numerically.
import { Hole } from './stipple';

export function computeMinWeb(holes: Hole[], W: number, cellSize: number): number {
  if (holes.length < 2 || cellSize <= 0) return Infinity;

  const cols = Math.max(1, Math.floor(W / cellSize));
  const cw = W / cols;
  const buckets = new Map<number, number[]>();
  const rowKeyScale = 1 << 20;

  const cellOf = (h: Hole): [number, number] => {
    const cx = Math.floor((((h.x % W) + W) % W) / cw);
    const ry = Math.floor(h.y / cellSize);
    return [cx, ry];
  };
  const key = (cx: number, ry: number) => ry * rowKeyScale + cx;

  for (let idx = 0; idx < holes.length; idx++) {
    const [cx, ry] = cellOf(holes[idx]);
    const k = key(cx, ry);
    let bucket = buckets.get(k);
    if (!bucket) buckets.set(k, (bucket = []));
    bucket.push(idx);
  }

  let minWeb = Infinity;
  for (let idx = 0; idx < holes.length; idx++) {
    const h = holes[idx];
    const [cx, ry] = cellOf(h);
    for (let dcx = -1; dcx <= 1; dcx++) {
      const ncx = ((cx + dcx) % cols + cols) % cols;
      for (let dry = -1; dry <= 1; dry++) {
        const bucket = buckets.get(key(ncx, ry + dry));
        if (!bucket) continue;
        for (const jdx of bucket) {
          if (jdx <= idx) continue;
          const o = holes[jdx];
          let dx = o.x - h.x;
          dx = (((dx + W / 2) % W) + W) % W - W / 2;
          const dy = o.y - h.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const web = dist - h.r - o.r;
          if (web < minWeb) minWeb = web;
        }
      }
    }
  }
  return minWeb;
}
