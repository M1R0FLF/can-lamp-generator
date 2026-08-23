// "Lighthouse" — a lit tower and a boat on a night sea.
//
// Rebuilt after the first version was unreadable. Three things were wrong, and
// all three are rules in CLAUDE.md:
//
//  - The tower was BLACK against a dark sky, so the subject had nothing to
//    separate it from the ground. It is now the bright hero with dark daymark
//    bands cut into it (rule 5: dark cuts inside a bright form carry the
//    detail), moated hard against the sky (rule 4).
//  - A keeper's house and a shoreline rock merged into a black mass bigger than
//    the tower itself, so the eye read the accessory, not the subject (rule
//    3b). Both are gone; only a small plinth remains.
//  - The tower was too small. It is now ~half the wall height — the
//    single-hero target in rule 3b.
//
// The beams stay wide filled wedges rather than strokes, and are held below the
// tower's brightness so they support it instead of competing.
import { FieldCtx, clamp01, maxInto, subtractInto, rim, heroSize, motifCount, harmonic } from '../fieldkit';
import { circle, poly, band, thickline, rect, wedge, DrawCtx } from '../draw';
import { Preset } from './types';

/** Sailboat: closed hull, mast, and two big triangular sails. */
function boat(d: DrawCtx, cx: number, waterY: number, L: number) {
  const hullH = L * 0.2;
  // hull — a closed wedge sitting in the water
  poly(d, [
    [cx - L * 0.5, waterY],
    [cx + L * 0.5, waterY],
    [cx + L * 0.3, waterY - hullH],
    [cx - L * 0.34, waterY - hullH],
  ], 255);
  // dark waterline stripe so the hull has internal structure
  thickline(d, [[cx - L * 0.44, waterY - hullH * 0.42], [cx + L * 0.4, waterY - hullH * 0.42]], hullH * 0.22, 0);

  // mast
  thickline(d, [[cx - L * 0.04, waterY], [cx - L * 0.04, waterY + L * 0.95]], L * 0.05, 255);
  // mainsail: the big closed triangle that makes it read as a boat
  poly(d, [
    [cx + L * 0.02, waterY + L * 0.9],
    [cx + L * 0.02, waterY + hullH * 0.6],
    [cx + L * 0.46, waterY + hullH * 0.6],
  ], 255);
  // foresail
  poly(d, [
    [cx - L * 0.1, waterY + L * 0.86],
    [cx - L * 0.1, waterY + hullH * 0.6],
    [cx - L * 0.42, waterY + hullH * 0.6],
  ], 255);
  // dark seams inside the mainsail
  for (let k = 1; k <= 2; k++) {
    const t = k / 3;
    thickline(
      d,
      [
        [cx + L * 0.02, waterY + hullH * 0.6 + t * (L * 0.9 - hullH * 0.6)],
        [cx + L * 0.46 * (1 - t), waterY + hullH * 0.6],
      ],
      L * 0.03,
      0
    );
  }
}

function build(ctx: FieldCtx): Float32Array {
  const { W, H } = ctx;
  const seaTop = 0.3 * H;
  const yLo = 8.5;
  const skyTop = H - 8.5;

  // Tower sits at a fraction of the wrap so it stays put at any diameter.
  const towerX = 0.24 * W;
  const towerBase = seaTop - 1.5;
  const towerH = heroSize(W, H, 68, 0.3, 0.48);
  const lampY = towerBase + towerH;

  // --- sky: dark, with a broad halo around the lamp ---
  let F = ctx.fn((x, y) => {
    if (y < yLo || y > skyTop) return 0;
    const d = Math.hypot(ctx.dx(towerX, x), (y - lampY) * 1.1);
    return Math.min(1, 0.05 + 0.5 * Math.exp(-Math.pow(d / 30, 2)));
  });

  // --- beams: wide wedges, deliberately dimmer than the tower ---
  const beamLen = Math.max(W * 0.4, 74);
  const beams = ctx.mask((d: DrawCtx) => {
    const spans: Array<[number, number]> = [
      [10, 24],
      [34, 50],
      [130, 146],
      [156, 170],
    ];
    for (const [a0, a1] of spans) wedge(d, towerX, lampY, 3.0, beamLen, a0, a1, 255);
  });
  for (let i = 0; i < F.length; i++) if (beams[i] > 0) F[i] = Math.max(F[i], 0.44);

  // dark radial partings inside the beams so they aren't flat slabs
  const beamRibs = ctx.mask((d: DrawCtx) => {
    for (let k = 1; k <= 4; k++) {
      const r = (beamLen * k) / 5;
      const pts: Array<[number, number]> = [];
      for (let s = 0; s < 44; s++) {
        const a = ((8 + (164 * s) / 43) * Math.PI) / 180;
        pts.push([towerX + r * Math.cos(a), lampY + r * Math.sin(a)]);
      }
      thickline(d, pts, 0.6, 255);
    }
  });
  for (let i = 0; i < F.length; i++) if (beamRibs[i] > 0.5 && beams[i] > 0) F[i] *= 0.4;
  clamp01(F);

  // --- the tower: bright hero, dark bands cut in ---
  const tower = ctx.mask((d: DrawCtx) => {
    const wBase = 15.5;
    const wTop = 8.6;
    poly(d, [
      [towerX - wBase / 2, towerBase],
      [towerX + wBase / 2, towerBase],
      [towerX + wTop / 2, lampY - 6.0],
      [towerX - wTop / 2, lampY - 6.0],
    ], 255);
    // gallery deck, slightly wider than the shaft
    rect(d, towerX - 7.4, lampY - 6.6, 14.8, 2.3, 255);
    // lamp room
    rect(d, towerX - 4.6, lampY - 4.3, 9.2, 8.4, 255);
    // conical roof
    poly(d, [[towerX - 5.6, lampY + 4.1], [towerX + 5.6, lampY + 4.1], [towerX, lampY + 11.5]], 255);
    // small plinth only — no rock, no keeper's house (rule 3b)
    poly(d, [
      [towerX - 11.5, towerBase - 3.4],
      [towerX + 11.5, towerBase - 3.4],
      [towerX + 8.8, towerBase + 0.6],
      [towerX - 8.8, towerBase + 0.6],
    ], 255);
  });

  // dark daymark bands + gallery railing, cut INTO the bright tower
  const towerDark = ctx.mask((d: DrawCtx) => {
    for (let k = 0; k < 3; k++) {
      const y = towerBase + 6.5 + k * ((towerH - 16) / 3);
      rect(d, towerX - 9, y, 18, 4.6, 255);
    }
    // railing slots under the gallery
    for (let k = -3; k <= 3; k++) {
      thickline(d, [[towerX + k * 2.1, lampY - 6.4], [towerX + k * 2.1, lampY - 4.6]], 0.55, 255);
    }
    // lamp room glazing bars
    thickline(d, [[towerX - 4.6, lampY - 0.4], [towerX + 4.6, lampY - 0.4]], 0.7, 255);
    thickline(d, [[towerX, lampY - 4.3], [towerX, lampY + 4.1]], 0.7, 255);
  });

  F = ctx.moat(F, tower, 3.2, 1.0);
  for (let i = 0; i < F.length; i++) if (towerDark[i] > 0.5 && tower[i] > 0) F[i] = 0.06;

  // --- the lamp itself: the one thing brighter than the tower ---
  const lamp = ctx.mask((d: DrawCtx) => {
    circle(d, towerX, lampY, 3.4, 255);
  });
  maxInto(F, lamp);

  // --- the boat, well clear of the tower on the far side of the wrap ---
  const boatL = heroSize(W, H, 26, 0.16, 0.2);
  const boats = ctx.mask((d: DrawCtx) => {
    boat(d, 0.7 * W, seaTop - 4.0, boatL);
  });
  F = ctx.moat(F, boats, 2.8, 1.0);

  // --- sea: dark water, bright crests, brightest in the glitter path ---
  const crests = ctx.mask((d: DrawCtx) => {
    const rows = Math.max(6, Math.round((seaTop - yLo) / 4.0));
    for (let j = 0; j < rows; j++) {
      const y = yLo + 1.5 + (j * (seaTop - yLo - 2)) / rows;
      const n = harmonic(W, 15 + j * 1.6);
      const amp = 0.7 + j * 0.1;
      const pts: Array<[number, number]> = [];
      for (let s = 0; s <= 150; s++) {
        const x = (s / 150) * W;
        pts.push([x, y + amp * Math.sin((2 * Math.PI * n * x) / W + j)]);
      }
      thickline(d, pts, 0.85 + j * 0.06, 255);
    }
  });
  const glitter = ctx.fn((x, y) => {
    if (y > seaTop) return 0;
    const lane = Math.exp(-Math.pow(ctx.dx(towerX, x) / (W * 0.19), 2));
    return 0.24 + 0.76 * lane;
  });
  F = ctx.dimTexture(F, crests, 0.7, glitter);
  // keep the water out of the tower's moat so the plinth edge stays crisp
  subtractInto(F, rim(ctx, tower, 1.6), 0.85);

  for (let row = 0; row < ctx.Hp; row++) {
    const y = ctx.yAt(row);
    if (y >= yLo && y <= skyTop) continue;
    F.fill(0, row * ctx.Wp, row * ctx.Wp + ctx.Wp);
  }

  const borders = ctx.mask((d: DrawCtx) => {
    band(d, 3.7, 1.2);
    band(d, H - 6.0, 1.2);
    band(d, H - 2.6, 2.6);
    const m = motifCount(W, 46, 2);
    for (let k = 0; k < m; k++) circle(d, ((k + 0.45) / m) * W, seaTop + 1.2, 0.8, 255);
  });
  maxInto(F, borders);
  return clamp01(F);
}

export const lighthouse: Preset = {
  id: 'lighthouse',
  name: 'Lighthouse',
  group: 'urban',
  description: 'A banded lighthouse throwing wedge beams over a night sea, with a boat under sail.',
  stipple: { pitchMm: 1.25, dMin: 0.26, dMax: 0.5, jitter: 0.1, thresh: 0.07, mode: 'hybrid', knee: 0.44, gamma: 0.62 },
  build,
};
