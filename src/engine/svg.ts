import { Hole } from './stipple';
import type { LedNotch } from './generate';

/**
 * Semicircular notch flush with the can's bottom edge (SVG y = H): a straight
 * edge along y=H from (x-r,H) to (x+r,H), closed by an arc bulging up into
 * the design. Never asks the laser to cut past y=H — see the LedHoleSpec
 * comment in generate.ts for why that boundary matters here specifically.
 * `sweep-flag=1` from the left point to the right point traces the upper
 * semicircle (SVG y grows downward, so "upper" is the smaller-y arc).
 */
function notchPath(n: LedNotch, H: number): string {
  const x0 = (n.x - n.r).toFixed(3);
  const x1 = (n.x + n.r).toFixed(3);
  const y = H.toFixed(3);
  const r = n.r.toFixed(3);
  return `<path d="M ${x0} ${y} A ${r} ${r} 0 0 1 ${x1} ${y} Z"/>`;
}

export function writeSvg(holes: Hole[], W: number, H: number, title: string, ledNotch?: LedNotch | null): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(3)}mm" height="${H.toFixed(3)}mm" viewBox="0 0 ${W.toFixed(3)} ${H.toFixed(3)}">`,
    `<title>${title}</title>`,
    '<g id="holes" fill="#000000" stroke="none">',
  ];
  for (const { x, y, r } of holes) {
    lines.push(`<circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r="${r.toFixed(3)}"/>`);
  }
  if (ledNotch) lines.push(notchPath(ledNotch, H));
  lines.push('</g>', '</svg>');
  return lines.join('\n');
}
