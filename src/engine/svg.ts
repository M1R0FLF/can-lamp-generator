import { Hole } from './stipple';

export function writeSvg(holes: Hole[], W: number, H: number, title: string): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(3)}mm" height="${H.toFixed(3)}mm" viewBox="0 0 ${W.toFixed(3)} ${H.toFixed(3)}">`,
    `<title>${title}</title>`,
    '<g id="holes" fill="#000000" stroke="none">',
  ];
  for (const { x, y, r } of holes) {
    lines.push(`<circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r="${r.toFixed(3)}"/>`);
  }
  lines.push('</g>', '</svg>');
  return lines.join('\n');
}
