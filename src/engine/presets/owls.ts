// "Owls" — owls on a bare branch under a full moon.
//
// The owl is close to an ideal subject for rule 3: a single fat teardrop
// silhouette, ~26mm tall, with the whole character carried by DARK cuts inside
// it (eye rings, beak, wing line) rather than by any outline detail. Nothing
// here is thinner than the moat can protect.
//
// The branch is a solid black bar rather than a twiggy structure on purpose —
// the first instinct is to draw fine twigs, and fine twigs are exactly what
// dissolves at this pitch.
import { FieldCtx, clamp01, maxInto, specks, subtractInto, rim, heroSize, motifCount, harmonic, wrapVary } from '../fieldkit';
import { circle, ell, poly, band, thickline, taper2, DrawCtx } from '../draw';
import { mulberry32 } from '../rng';
import { Preset } from './types';

/** One owl: body teardrop, ear tufts, dark face detail. */
function owl(d: DrawCtx, cx: number, baseY: number, hgt: number, look: 1 | -1) {
  const bw = hgt * 0.42; // body half-width
  const cy = baseY + hgt * 0.5;

  // body: a rounded teardrop built from an ellipse plus a wider base
  ell(d, cx, cy, bw, hgt * 0.5, 255);
  ell(d, cx, baseY + hgt * 0.22, bw * 1.04, hgt * 0.24, 255);

  // ear tufts
  poly(d, [
    [cx - bw * 0.86, baseY + hgt * 0.78],
    [cx - bw * 0.2, baseY + hgt * 0.86],
    [cx - bw * 0.5, baseY + hgt * 1.06],
  ], 255);
  poly(d, [
    [cx + bw * 0.86, baseY + hgt * 0.78],
    [cx + bw * 0.2, baseY + hgt * 0.86],
    [cx + bw * 0.5, baseY + hgt * 1.06],
  ], 255);

  // --- dark structure inside the solid ---
  const eyeY = baseY + hgt * 0.74;
  const eyeDx = bw * 0.42;
  // facial disc: a broad dark mask across the eyes
  ell(d, cx, eyeY, bw * 0.82, hgt * 0.15, 0);
  // bright irises punched back in, so the eyes read as eyes
  circle(d, cx - eyeDx, eyeY, bw * 0.2, 255);
  circle(d, cx + eyeDx, eyeY, bw * 0.2, 255);
  circle(d, cx - eyeDx + look * bw * 0.06, eyeY, bw * 0.085, 0);
  circle(d, cx + eyeDx + look * bw * 0.06, eyeY, bw * 0.085, 0);
  // beak
  poly(d, [
    [cx - bw * 0.13, eyeY - hgt * 0.05],
    [cx + bw * 0.13, eyeY - hgt * 0.05],
    [cx, eyeY - hgt * 0.15],
  ], 0);
  // folded wing: one long dark arc down the side
  taper2(d, [cx + look * bw * 0.62, baseY + hgt * 0.6], [cx + look * bw * 0.42, baseY + hgt * 0.14], bw * 0.3, bw * 0.16, 0);
  // breast barring — dark dashes, texture inside the form only
  for (let k = 0; k < 3; k++) {
    const y = baseY + hgt * (0.3 + k * 0.11);
    thickline(d, [[cx - bw * 0.4, y], [cx + bw * 0.4, y]], hgt * 0.022, 0);
  }
  // feet gripping the branch
  thickline(d, [[cx - bw * 0.3, baseY + 0.6], [cx - bw * 0.3, baseY - 1.4]], 1.0, 255);
  thickline(d, [[cx + bw * 0.3, baseY + 0.6], [cx + bw * 0.3, baseY - 1.4]], 1.0, 255);
}

function build(ctx: FieldCtx): Float32Array {
  const { W, H } = ctx;
  const rng = mulberry32(2244);
  const yLo = 8.5;
  const skyTop = H - 8.5;
  const branchY = 0.36 * (skyTop - yLo) + yLo;

  // --- night sky: a soft vertical wash, darkest at the top ---
  // Kept deliberately dim. An earlier pass had this at 0.1 + 0.16 and the
  // owls drowned in it — per rule 3b the ground has to stay subordinate.
  let F = ctx.fn((_x, y) => {
    if (y < yLo || y > skyTop) return 0;
    return 0.05 + 0.09 * Math.exp(-Math.max(y - branchY, 0) / 60);
  });

  // --- moon: a secondary anchor, kept small and placed clear of the owls ---
  // It used to be 22mm and sat directly behind a bird; the two merged into one
  // unreadable shape (rule 3b). Now it is smaller and sits high, between them.
  const moonR = heroSize(W, H, 13);
  const moonX = 0.66 * W;
  const moonY = skyTop - moonR - 5;
  const moon = ctx.mask((d: DrawCtx) => {
    circle(d, moonX, moonY, moonR, 255);
    // maria: dark blotches so the disc isn't a flat plate
    circle(d, moonX - moonR * 0.3, moonY + moonR * 0.24, moonR * 0.26, 0);
    circle(d, moonX + moonR * 0.26, moonY - moonR * 0.1, moonR * 0.19, 0);
    circle(d, moonX - moonR * 0.05, moonY - moonR * 0.42, moonR * 0.14, 0);
  });
  subtractInto(F, rim(ctx, moon, 3.2), 0.9);
  maxInto(F, moon);
  clamp01(F);

  maxInto(
    F,
    specks(ctx, {
      count: Math.max(45, Math.round((210 * W) / 204.2)),
      seed: 224,
      sizeLo: 0.45,
      sizeHi: 0.85,
      yLo: branchY + 4,
      yHi: skyTop - 3,
    })
  );

  // --- the branch: one solid black bar with a slight sag ---
  const branch = ctx.mask((d: DrawCtx) => {
    const pts: Array<[number, number]> = [];
    const n = harmonic(W, 150);
    for (let s = 0; s <= 120; s++) {
      const x = (s / 120) * W;
      pts.push([x, branchY + 1.9 * Math.sin((2 * Math.PI * n * x) / W)]);
    }
    thickline(d, pts, 4.6, 255);
    // a few stubby side shoots — short and fat, never twiggy
    const m = motifCount(W, 26, 3);
    for (let k = 0; k < m; k++) {
      const x = ((k + 0.7) / m) * W;
      const up = k % 2 === 0 ? 1 : -1;
      thickline(d, [[x, branchY], [x + 5.5, branchY + up * 7.0]], 2.6, 255);
    }
  });

  // --- owls: the subject, sized to actually dominate (rule 3b) ---
  // 27mm cleared the rule-3 floor and still read as "small blobs" from across
  // a room. 42mm is ~30% of a 142mm wall, and three of them beat four.
  const owlH = heroSize(W, H, 42, 0.26, 0.32);
  const owlCount = motifCount(W, 74, 2);
  const birds = ctx.mask((d: DrawCtx) => {
    for (let k = 0; k < owlCount; k++) {
      const cx = ((k + 0.5) / owlCount) * W + (rng() - 0.5) * 3.0;
      // size via wrapVary() rather than `k % 3` so no two same-size owls end up
      // adjacent across the seam (see fieldkit)
      const scale = 0.9 + 0.1 * wrapVary(k, owlCount);
      owl(d, cx, branchY + 2.2, owlH * scale, wrapVary(k, owlCount, 1, 0.4) >= 0 ? 1 : -1);
    }
  });

  // branch is black, punched out of the sky; owls are bright with a wide moat
  subtractInto(F, branch, 1.0);
  F = ctx.moat(F, birds, 3.0, 1.0);

  // --- dim foliage texture below the branch (rule 7) ---
  // Sparse and confined to the lower half of the space under the branch, so
  // there is real dark breathing room around the birds rather than an
  // all-over texture competing with them.
  const leaves = ctx.mask((d: DrawCtx) => {
    const m = motifCount(W, 9.0, 6);
    for (let k = 0; k < m; k++) {
      const x = (k + 0.5) * (W / m) + (rng() - 0.5) * 3;
      const y = yLo + rng() * (branchY - yLo) * 0.55;
      const a = rng() * 180;
      const L = 2.2 + rng() * 2.4;
      taper2(
        d,
        [x - L * Math.cos((a * Math.PI) / 180), y - L * Math.sin((a * Math.PI) / 180)],
        [x + L * Math.cos((a * Math.PI) / 180), y + L * Math.sin((a * Math.PI) / 180)],
        1.5,
        0.3,
        255
      );
    }
  });
  F = ctx.dimTexture(F, leaves, 0.1);

  for (let row = 0; row < ctx.Hp; row++) {
    const y = ctx.yAt(row);
    if (y >= yLo && y <= skyTop) continue;
    F.fill(0, row * ctx.Wp, row * ctx.Wp + ctx.Wp);
  }

  const borders = ctx.mask((d: DrawCtx) => {
    band(d, 3.7, 1.2);
    band(d, H - 6.0, 1.2);
    band(d, H - 2.6, 2.6);
  });
  maxInto(F, borders);
  return clamp01(F);
}

export const owls: Preset = {
  id: 'owls',
  name: 'Owls',
  group: 'nature',
  description: 'Owls perched on a bare branch against a big pitted moon.',
  stipple: { pitchMm: 1.25, dMin: 0.26, dMax: 0.5, jitter: 0.1, thresh: 0.08, mode: 'hybrid', knee: 0.45, gamma: 0.66 },
  build,
};
