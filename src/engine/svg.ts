import { Hole } from './stipple';
import type { LedNotch, BottomCut } from './generate';

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

/**
 * The separation cut, as a stroked red line in its OWN group, emitted after
 * everything else. Both of those are load-bearing, because SVG itself has no
 * notion of cut order — the importing laser software invents one, and the two
 * things it invents it from are document order and colour:
 *
 *  - **xTool Creative Space** defines layers by the colour of the vector
 *    lines, and processes "the vertical layer order, from the top layer down
 *    to the bottom" — the list is built as the file is read, so last in the
 *    document is bottom of the list is cut last. (Its "Auto planning" mode
 *    instead does engrave-then-cut and prefers interior geometry first, which
 *    happens to land the same way round for a full-width line, but that is
 *    luck; "By layer" is the mode that actually honours this.)
 *  - **LightBurn** likewise processes layers in the order they appear in the
 *    Cuts list, with black as C00 — so a non-black stroke sorts after the
 *    holes there too. Red for cuts / black for engraving is that world's
 *    convention anyway.
 *
 * Neither is a guarantee (both let the operator drag the order around, and
 * LightBurn is known to reshuffle on re-import), which is why this also
 * carries a comment in the file for whoever opens it. A separate colour is
 * what makes the reorder possible AND lets the separation cut take its own
 * power/passes — it is one continuous 0.1mm-aluminium through-cut, not a
 * stipple hole, and wants its own settings.
 */
const SEPARATION_STROKE = '#ff0000';
const SEPARATION_STROKE_MM = 0.1;

function bottomCutGroup(cut: BottomCut, W: number): string[] {
  const y = cut.y.toFixed(3);
  return [
    '<!-- Separation cut: LAST on purpose. Every hole above must already be',
    '     cut before this line severs the base, or the offcut moves mid-job.',
    '     Its own colour so it lands in its own layer/operation - give it the',
    '     passes a full through-cut needs, and check it is ordered last. -->',
    `<g id="bottom-cut" fill="none" stroke="${SEPARATION_STROKE}" stroke-width="${SEPARATION_STROKE_MM}">`,
    `<path d="M 0 ${y} L ${W.toFixed(3)} ${y}"/>`,
    '</g>',
  ];
}

export interface CutExtras {
  ledNotch?: LedNotch | null;
  /** emitted last, after every other cut in the file — see bottomCutGroup */
  bottomCut?: BottomCut | null;
}

export function writeSvg(
  holes: Hole[],
  W: number,
  H: number,
  title: string,
  extras: CutExtras = {}
): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(3)}mm" height="${H.toFixed(3)}mm" viewBox="0 0 ${W.toFixed(3)} ${H.toFixed(3)}">`,
    `<title>${title}</title>`,
    '<g id="holes" fill="#000000" stroke="none">',
  ];
  for (const { x, y, r } of holes) {
    lines.push(`<circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r="${r.toFixed(3)}"/>`);
  }
  if (extras.ledNotch) lines.push(notchPath(extras.ledNotch, H));
  lines.push('</g>');
  if (extras.bottomCut) lines.push(...bottomCutGroup(extras.bottomCut, W));
  lines.push('</svg>');
  return lines.join('\n');
}
