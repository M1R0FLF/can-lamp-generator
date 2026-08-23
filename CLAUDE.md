# Perforated Can Lamp Generator

A browser tool that turns parametric designs into laser-ready SVG perforation patterns
for aluminium drink cans, which are then backlit as lamps.

Hardware context: 20 W fiber laser + rotary attachment, cutting **through** ~0.1 mm
aluminium can wall. Every hole in the SVG is a through-cut.

## Reference implementations

`/reference/mango_salvaje_generator.py` and `/reference/escarcha_generator.py` are
working, tuned Python generators. They are the **specification**. Their tone-mapping
constants, layout numbers and threshold values were arrived at through many rounds of
visual iteration — do not "clean them up" or round them off. Port the behaviour, keep
the numbers.

A third generator (halftone portrait) exists but is **out of scope** — it needs OpenCV.

---

## Domain rules — the expensive lessons

These were each learned by getting them wrong first.

### 1. Positions must be fractions of circumference, never absolute mm

The canvas is `W = π × diameter` wide and wraps seamlessly. When the diameter changed
from 66.2 → 65 mm, every hardcoded-in-mm element shifted relative to the seam and the
layout broke. Same again on the height change.

Store `x` as a fraction of `W`. Store `y` as `{anchor: 'top'|'bottom'|'center', offset}`.
Since users can type any diameter, this is not optional.

### 2. `pitch ≥ d_max + min_web`

On a hex grid with **zero jitter**, all six neighbours sit at exactly `pitch`, so this is
exact. Add jitter and it degrades — compute the true minimum numerically from the
generated holes and display it live. Below ~0.3 mm the webs tear on 0.1 mm aluminium.

Reference values: Escarcha 1.15 mm pitch / 0.52 mm max → 0.365 mm min web.
Portrait 0.98 mm pitch / zero jitter / 0.56 mm max → 0.422 mm min web.

### 3. Big closed forms read; filigree does not

At ~1.2 mm pitch a thin branching structure dissolves into noise. A solid form with dark
cuts inside it reads from across the room. The first Escarcha hero was a botanically
correct dendrite and it was invisible; replacing it with a chunky solid six-point star
fixed it. **Minimum legible feature ≈ 16 mm and closed.**

### 4. Bright shapes need a dark moat

Stroke the path in black at `lineWidth = 2 × moat` *before* filling it white. ~3 mm.
Without the moat, a bright shape sitting in textured background has no figure/ground
separation. This is the single biggest legibility lever.

### 5. Density carries tone, not size

Hole diameter alone spans maybe 4× in area — not enough. Real blacks (no holes at all)
are what make the image read. Three modes, all needed:

- **FM** (density dither, fixed size) — background texture
- **AM** (fixed density, size varies as `√tone` so open area is linear in tone) — smooth gradients
- **Hybrid** — full density above a knee, density falls off below it. Best general default.

### 6. Band-limit before sampling

Downsample the field to grid resolution and back up before sampling holes. Anything finer
than the grid becomes aliasing, not detail. Sharpening filters actively hurt here.

### 7. Busy ≠ no black

Fill quiet areas with a *dim* texture layer (crack network, guilloché) at roughly 1/7 the
per-area brightness of the hero shapes. Uniform mid-tone everywhere destroys contrast.

### 8. Boring is fine. Empty and overstuffed are not.

Learned from rating all 13 presets against the user's taste (2026-08-23): a plain,
repeating, "boring" pattern (a tiled star, a wave grid) is a perfectly good preset. It does
not need to be conceptually ambitious to be good. What actually fails a preset is either
extreme:

- **Too little visual material.** Mostly black/empty canvas with a thin scattering of
  content — reads as broken, not minimalist. Killed the "Current" preset (two thin wavy
  bands, 1.3% open area).
- **Too much fussy detail.** Fine intricate structure — thin branching lines, tiny
  scattered sub-elements — that fights legibility at this pitch (this is rule 3 again,
  restated as a design taste rather than a technical constraint). The "Orrery" constellation
  lines and "Circuit" preset's PCB traces both got called out for this: decent concepts,
  but the execution didn't hold together as a shape you can actually read.

Concept quality and execution quality are separate axes — score them separately. "Circuit"
had a good concept (PCB motif) but bad execution (didn't actually read as circuitry); that's
a redesign candidate, not a delete.

**Automated guardrail**: [`qualityPresets.ts`](src/engine/qualityPresets.ts)'s
`DEFAULT_OPEN_AREA_MIN_PCT` / `DEFAULT_OPEN_AREA_MAX_PCT` catch the "too little visual
material" failure numerically — the live readout's Open Area goes red outside 1.8-8%,
calibrated against the rated pass (sparse/bad presets sat at 1.3-1.7%, every good preset
was ≥2.0%). There is no reliable numeric check for "too much fussy detail" — that's a
composition judgment, not a density one. Catch it the way it was caught here: generate the
preset, look at the flat unlit/lit render, and ask whether it reads as one or two big
shapes from across the room (rule 3) or dissolves into noise.

---

## Port plan

**Do not port the numpy.** Every field op maps onto Canvas2D, which rasterizes in C.

| Python | Browser |
|---|---|
| 3-tile array + `np.maximum.reduce` fold | draw each path 3× at `x-W`, `x`, `x+W`; canvas clips free |
| `MaxFilter` dilation for moats | stroke black under the fill |
| radial/linear field math | canvas gradients |
| brute-force Voronoi (460 seeds × 1.9 M px) | `d3-delaunay` → `voronoi.render()` → one stroked Path2D |
| field sampling | one `getImageData`, then walk the hex grid |

Target: full regeneration < ~200 ms. Web Worker + OffscreenCanvas; preview at 4 px/mm
while dragging, re-render at 8 px/mm on release.

## Stack

Vite + vanilla TS. No framework needed. Deps: `d3-delaunay` only.

## Build order

1. Engine alone: field → sample → SVG string. One preset. No UI.
2. **Verify**: regenerate Mango Salvaje at Ø65 × 142 mm and diff the hole count and
   bounding box against `/reference/mango_salvaje_variabel.svg` (4997 holes, 0.28–0.52 mm).
   Close enough is fine; wildly off means the field port is wrong.
3. UI around the working engine.

Do not build the UI first.

## UI surface

- **Can**: diameter, wall height (the *straight* section — warn that the neck taper and
  base flare are excluded and that perforating a taper puts the galvo out of focus)
- **Presets**: Mango Salvaje, Escarcha
- **Quality**: `(pitch, d_min, d_max, jitter)` tuples, each showing hole count and rough
  cut-time estimate
- **Advanced**: those four individually, plus min-web target
- **Live readout**: hole count + measured min web, red when under target
- **Preview**: unlit (dots on metal) / lit (backlit glow) toggle, and a cylinder mock-up
- **Export**: SVG at exact mm dimensions, `viewBox = "0 0 W H"`

## Constraints

- Output SVG must be exactly `π × D` × wall height in mm so rotary software imports 1:1
- Seamless wrap in X is a hard requirement — verify by tiling the preview 2× and inspecting
- Presets are original designs. Do not add brand logos or trade dress; the cans are just
  the substrate.
