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

### 1b. The last motif is the first motif's NEIGHBOUR — never vary by `k % n`

A corollary of rule 1 that is easy to miss because the flat preview hides it. On a wrapped
canvas motif `count-1` sits directly beside motif `0`. So any per-motif variation written
as `k % n` — height, size, facing, tilt — silently produces two identical neighbours
whenever `count` is not a multiple of `n`:

```
count = 4, variation = k % 3   ->   0, 1, 2, 0
                                    ^           ^  adjacent across the seam
```

Caught in the wild: Balloons placed 4 balloons with `k % 3` heights, so two ended up at
the same altitude right next to each other over the seam. Strict alternation (`k % 2`) is
worse still — it is topologically *impossible* to close on a wrap with an odd count, and
`motifCount()` returns odd counts at plenty of diameters.

Use **`wrapVary(k, count, harmonics, phase)`** from `fieldkit.ts` instead. It drives the
variation from an integer harmonic of the angle around the can, so it is continuous across
the seam at every diameter. Verify with the preview's "Tile 2× to verify the seam" toggle.

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

### 3b. The subject must DOMINATE, not merely clear the minimum

16 mm is a floor, not a target, and clearing it is not the same as designing well. The
real viewing condition is **a can standing upright, seen from across a room** — so the
hero has to own the canvas, and every decorative layer has to stay clearly subordinate
to it.

The failure this rule exists to prevent, in the user's words: *"good idea but too little
owl (main detail), too much decoration/fill."* The Owls preset had 27 mm owls — well over
the rule-3 floor — and still failed, because they were small relative to the moon and
buried in a full-canvas foliage texture, so the eye read "busy dark rectangle" instead of
"owls". Honeycomb failed the same way: the bees were technically big enough but were
outcompeted by a bright comb covering the entire wall.

Practical guidance — note the target depends on how many subjects there are:

- **Single-hero designs** (Eclipse's disc, one big moon): the hero should own roughly
  **a third to a half of the wall height** — on a 142 mm can, 45-70 mm.
- **Repeated-subject scenes** (balloons, owls, cars): each subject wants to be about
  **a quarter of the wall height**, ~30-40 mm on a 142 mm can. Do NOT push these to
  half the wall — asked whether the balloons should be bigger, the user's correction was
  *"not much bigger, just a tad"*. Overshooting here is its own failure mode.
- Prefer **two or three subjects over five or six.** `motifCount()` exists to add copies
  on a wider can, but a footprint yielding 5+ heroes on a standard can usually means
  each one is too small.
- **Fill is a supporting player, and this matters more than absolute size.** Owls failed
  at 27 mm mostly because a full-canvas foliage texture competed with it. If a background
  texture covers the whole wall at comparable brightness, it is fighting the subject.
  Give the hero genuinely dark breathing room next to it, not just a moat.
- A second bright element (a moon, a sun) must not sit **behind or touching** the hero;
  they merge and both become unreadable. Separate them, or make one clearly subordinate.
- **Accessory shapes can swamp the subject too.** Lighthouse failed because a rock and a
  keeper's house merged into a black mass larger than the tower itself. Every secondary
  form has to stay visibly smaller and dimmer than the thing it is supporting.

### 4. Bright shapes need a dark moat

Stroke the path in black at `lineWidth = 2 × moat` *before* filling it white. ~3 mm.
Without the moat, a bright shape sitting in textured background has no figure/ground
separation. This is the single biggest legibility lever.

**Corollary — a photo's local-contrast halo is a moat, so don't "fix" it.** Unsharp
masking against a blurred reference haloes by construction: measured against a 40mm
bright subject on textured dark ground, `photo.ts`'s 30mm local contrast drags the
background 7.3% darker where it meets the subject (and against a *hard*-edged subject
it clips 30mm of background to pure black). Replacing the blur with an edge-aware
guided filter cuts that to 1.5% — and makes the result **worse**, because the halo was
doing this rule's job for free. Rendered side by side the haloed portrait is brighter
and its eyes, nose shadow and mouth all read more clearly. Nor is it recoverable by
turning the amount up: a self-guided filter only amplifies variance *inside* a region
and smooth skin has almost none, so 0.45 → 0.95 moved open area 1.11% → 1.13% and
changed nothing visible. The edge-aware path ships as an opt-in escape hatch
(`PhotoParams.localContrastEdgeAware`, default off) for high-key images where several
bright regions' halos would eat all the background between them.

### 4b. A can is not a monitor — don't aim for a display gamma

The obvious tone target for a photo is an end-to-end exponent of 2.2, so open area
tracks the display-referred luminance of the original. `photo.ts` aimed at exactly that
and hit it: the sampler contributes a measured 1.373, so its `gamma` of 1.6 landed the
chain at 2.197, within 0.15% of target.

The arithmetic was right and **the target was wrong**. A monitor can output a real
white; a perforated can tops out at 11.67% open area at the Standard tuple, so the
entire output range is one dim eighth of the wall — and squaring it throws most of that
away. Measured on two real portraits shot against bright backgrounds, the face came out
at **1.29% open against a 3.15% background**: the subject rendered 2.4× darker than its
surroundings, which is rule 3b exactly inverted, and was reported as "both faces are
too dark".

Aim instead for open area proportional to **perceptual** tone — exponent ~1.0, so
`gamma` = 1/1.373 ≈ 0.7. The same face then measures 3.52% against 3.41%: slightly
brighter than its surroundings rather than a hole in them.

Two corollaries:

- **`vignette` is subject dominance, not decoration.** It darkens toward the frame, and
  on a portrait the frame is exactly where the background lives — so it is the one
  control that suppresses background without touching the subject. Dropping it from
  0.55 to 0.35 raised background open area 3.64% → 4.51% with the face unchanged; it is
  now 0.7 for the same reason in reverse.
- **Don't auto-invert a bright-background portrait.** It was built, it worked exactly as
  designed, and it looked worse: inverting a face makes hair bright and skin dark, i.e.
  a photographic negative, which reads as eerie rather than as a portrait. Those images'
  real problem was the gamma above, not their polarity. `invert` stays a manual button.

**The test that would have caught all of this is one real photograph.** The synthetic
portrait in `render.mjs` was built dark-background/light-subject — the single polarity
where a compressive curve does no visible harm — so it cleared every metric while the
default was badly wrong for the common case. `tools/measure/photos.mjs` exists to stop
that repeating: point it at real images and it flags face-vs-background open area, the
rule 8 band and the rule 2 floor per pattern.

### 4c. Punch is per-image, and the target is the only judgement in it

Rule 4b sets the tone curve's *shape*; the exponent itself cannot be a constant. Punch
(`PhotoParams.gamma`) trades face brightness against face contrast, and how much each
image needs depends on how much contrast the subject already carries. Measured on two
ordinary portraits, the values wanted were **0.7 and ~1.3** — nearly a factor of two —
because one face had glasses and dark hair supplying its own contrast and the other was
an evenly-lit studio shot whose features sat close to the skin tone. One constant served
the first and produced "too bright, you can't see face details anymore" on the second.

`solveAutoPunch()` closes the loop instead of guessing: probe two gammas, measure what
the real tone pipeline produces, interpolate to a target. Relative contrast is near
enough linear in gamma over the useful range that two probes suffice.

Three things that are easy to get wrong here:

- **Normalise contrast by the mean.** Raw RMS scales with brightness, so it scores any
  darkening as a contrast *loss* even when features became more distinct. Un-normalised,
  the measurement ranked higher gamma as worse — the exact opposite of what looking at
  the renders showed.
- **The target is resolution-coupled.** The solve runs at 2 px/mm for speed, where the
  same approved setting measures 0.2064 against 0.1959 at the render's 8. Shipping the
  8 px/mm number drove an image that wanted 0.70 onto the 0.60 clamp. `PROBE_PPM` and
  `AUTO_PUNCH_TARGET` are one calibration, not two knobs.
- **Measure the whole frame, and know which way that biases.** Nothing in production
  knows where the subject is, and this project cannot have a face detector. A large flat
  background reads low, so the solver overshoots on such images — landing 1.31 where a
  face-only match said ~1.1. No whole-image target can reproduce a face-only match on
  both images; that is the trade, and the direction at least favours contrast on exactly
  the images that lacked it.

The target is anchored on the single setting a human approved. If results drift, change
that number and nothing else.

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

### 9. The can has a front and a back — and one real hole isn't a stipple hole

Most cans stand on a shelf facing one way, and a lamp built from one has an LED strip
inside whose power cable has to exit *somewhere*. It exits the back, low on the wall.

**Front/back convention**: the flat design is authored to be viewed centred at
`x = W/2` — that's the front. The seam at `x = 0` / `x = W` (the same physical point
once rolled into a cylinder) is the back. This costs nothing to keep true: don't place
a second hero shape or bright element right at the seam, the way you already avoid
stacking two bright elements on top of each other (rule 3b).

**The LED wire hole** (toggle in the UI, `CanSpec.ledHole` in
[generate.ts](src/engine/generate.ts)) is a real through-cut sized for a 3mm cable —
nothing to do with the stippled pattern, and it must stay that way. First version was a
floating circle centred ~10mm up the wall; corrected on sight, in the user's words:
*"the led hole should be at the full bottom of can, even be a 'U' shaped cutout. NOT
THERE."* Current shape (`GenerateResult.ledNotch`, a `{x, r}` — y is implicitly `H`):

- **A semicircular notch flush with the bottom edge**, not a closed circle floating
  mid-wall. The flat side sits exactly on `y = H`, the arc bulges up into the design.
  This is safe specifically *because* `heightMm` is already the straight-wall section
  only — CLAUDE.md's own can-section warning about the excluded neck taper and base
  flare putting the galvo out of focus means `y = H` really is the edge of where it's
  safe to cut; the notch never asks the laser to go past it. `svg.ts`'s `notchPath()`
  builds the exact path (`M`/`A`/`Z`); `main.ts`'s `drawLedNotch()` draws the same shape
  for the previews via `ctx.arc(..., Math.PI, Math.PI*2)`.
- An open notch is also easier to assemble than a closed hole — the cable lays in
  sideways rather than being threaded end-first through a small circle.
- Kept **out of `holes`/`designHoles` entirely** — not just added after
  `computeMinWeb()` (an earlier fix), but never merged into that array at all. Two
  independent reasons: (1) `computeMinWeb` measures the closest edge-to-edge gap
  between every pair of holes, and a deliberate 3.4mm cutout in that list registers as
  a large negative "closest pair" distance against itself; (2) `holes` also feeds the
  Lit-mode backlit glow render, and this notch must **not glow** — once assembled a
  wire fills it and blocks the light, so *"it also shouldn't light up like that, it
  will be plugged up with a wire."* Being a separate field makes both true by
  construction instead of by special-casing.
- Drawn in Unlit/Field previews (where it's honestly an opening in bare metal, wire or
  not) but skipped entirely when composing the Lit glow texture.
- Position is computed from the physical can's real height (`H`), never the preset's
  142mm reference frame — see the `fromMm` handling in `generate()`. Without that, the
  notch would drift relative to the actual bottom edge on any preset being cropped down
  from its reference height. Same reasoning as the text annotation below.
- x sits a few mm off the *exact* seam (`x = min(6, W * 0.05)`), not on it — "back"
  only needs to be unambiguously away from the front, not the mathematically exact
  opposite point, and this keeps it on one side of the x=0/W wrap.

The same `fromMm`-aware positioning is what lets **the Personalize text annotation**
(also in generate.ts) say "bottom" and mean the can's actual bottom, regardless of
cropping — and it deliberately runs on the built `field`, not as a separate render
layer, so it gets the ordinary treatment: rule 6 band-limiting, rule 4's moat, and
rule 3's bold weight (thin fonts dissolve exactly like thin outlines do).

### 10. `dither` is an axis, not a look — and open area must stay flat across it

`stipple.ts` carries `mode` (fm/am/hybrid, how tone becomes density-and-size) and
`dither` (how the density decision is made at each cell). They are deliberately
independent, because that is the only way to add looks without restyling twenty tuned
presets: the default `hash` is the original code path and reproduces every preset
**hole-for-hole**. `tools/measure/baseline.mjs` prints a per-preset position checksum;
if it moves, something that should have been additive wasn't. (The checksums are also
why hole coordinates must stay `Float64` — staging them through a `Float32Array` shifts
every hole by nanometres and quietly destroys the property.)

Three combinations ship, via `generators.ts`:

| | MTF@48c | chaining | open area |
|---|---|---|---|
| Classic (hash) | 0.796 | 0.378 | 11.67% |
| Smooth (blue) | 0.785 | 0.013 | 11.67% |
| Detail (diffusion) | 0.897 | 0.153 | 11.67% |

`MTF@48c` is how much contrast survives at ~4mm features — the size of an eye in a
portrait. `chaining` is the concentration of nearest-neighbour directions at mid-tone;
high means the dots fall into lines, which reads as faint scratches across a smooth
gradient. Four things to take from it:

- **Judge a dither by direction, not by variance.** Density variance over 5×5-cell
  windows says all three are equally good (0.36–0.60× random). It is the wrong metric:
  the reference hash is a closed-form lattice function, so near simple rational
  densities it degenerates into visible chains, and only the directional statistic
  sees it. Smooth exists entirely because of that second measurement.
- **Open area must stay flat across the set**, or the picker doubles as a brightness
  control and every switch needs the tone sliders re-tuned. It is free for these three
  because they share the hex lattice. It is *not* free in general — see below.
- **Error diffusion's threshold modulation is a measured trade** (`ED_THRESHOLD_MOD`),
  not a taste: 0.12 gives chaining 0.294 / MTF 0.959, and 0.60 gives 0.095 / 0.816, by
  which point it has degraded back to mask-dither territory. 0.40 is the knee.
- **AM has no density decision**, so all three patterns are *identical* on an AM preset.
  Mango Salvaje is the library's one AM design and also the default, so the UI says so
  out loud rather than letting three buttons look dead.

Three things were built, measured, and deliberately left out. Do not re-attempt them
without reading these first.

- **Off-grid "Organic" (wrapped Poisson-disk, Bridson).** Worked, wrapped seamlessly,
  and was structurally the *safest* option — Poisson-disk enforces its minimum distance
  by construction and needs no jitter, so it measured a 0.524mm web where jittered hex
  measures 0.424mm from a nominal 0.93mm (rule 2's erosion, exactly). Dropped on the
  look: local density variation measured 0.220 at mid-tone against hex's 0.076, which
  reads as clumping rather than as hand-stippling. If it is ever revisited, the fix is
  to rank the actual point set (sample-elimination ordering) instead of tiling a 64×64
  mask over irregular points — and the thing worth keeping from the first attempt is
  that its packing constant had to be **measured**: the textbook 69%-of-hex figure
  predicts a 0.83 spacing factor, which came out 25% short because Bridson does not
  saturate. 0.72 matched hex density to 1.001. Any future off-grid pattern needs the
  same calibration or it silently changes exposure.
- **Tone linearisation**, which `photo.ts`'s own comment proposes.
  `tools/measure/response.ts` has the numbers: the normalised response curve is
  invariant within 3% across every dither and quality tuple, and the hard-coded
  `gamma: 1.6` already lands the end-to-end exponent within 0.15% of its 2.2 target.
  It would have replaced a verified-correct tuned constant with a computed one for no
  visible change.
- **Edge-aware local contrast as the default** — see rule 4's corollary.

Weighted Voronoi stippling (StippleGen) and weighted Linde–Buzo–Gray (Deussen 2017)
were both considered and rejected before implementation: they give the organic look and
neither gives a minimum-spacing guarantee, which rule 2 makes non-negotiable. The
lesson generalises — the algorithms worth porting from the halftoning literature are
the ones that act *on* the existing grid (error diffusion, void-and-cluster), because
those inherit rule 2 for free.

---

## Measurement harness

`tools/measure/` runs the real engine inside the preinstalled Chromium (the engine is
not portable to bare Node — `FieldCtx` and `photo.ts` both rasterize through a real
Canvas2D, which is the whole point of the port plan below).

```
node tools/measure/run.mjs tools/measure/baseline.mjs   # per-preset checksums - run before AND after any sampler change
node tools/measure/run.mjs tools/measure/mtf.mjs        # modulation transfer + reconstruction error
node tools/measure/run.mjs tools/measure/dither.mjs     # tone fidelity + uniformity
node tools/measure/run.mjs tools/measure/seam.mjs       # rule 1: density across x=0/W, and closest pair
node tools/measure/run.mjs tools/measure/render.mjs OUT # lit/unlit PNGs, for the judgments no metric makes
```

`run.mjs <script.mjs>` bundles `browser-entry.ts`, injects it, and hands the script a
`run(fn)` that evaluates `fn` in the page with `window.LAMP` holding the engine. A
constant field can be passed as a **1×1** array — `stipple()` clamps its sample index,
so every candidate point reads the same value, which is what makes response curves
cheap to measure against the real sampler instead of a model of it.

Use `render.mjs` for anything compositional. Rule 8 is explicit that there is no
numeric check for "too much fussy detail", and the same goes for whether a halo helps
or hurts (rule 4) — both were settled by looking at the PNGs, after the metrics had
pointed the wrong way.

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
- **Photo tone**: plain Brightness and Contrast sliders (neutral at 0) alongside Punch,
  Simplify and Local contrast. Brightness is a gain, not an offset, so black stays black
  per rule 5.
- **Personalize**: an optional short text label (name/date), composited on top of preset
  or custom alike — position as a fraction of circumference, vertical anchor + offset,
  letter height. See rule 9.
- **Back-of-can features**: LED wire hole toggle (rule 9), diameter/margin in Advanced.
- **Dot pattern**: the three named generators from `generators.ts` (rule 10), each with
  a one-line hint. Sits between Quality and Hole size, since it is a peer of both.
  Loading a photo switches to Detail unless the user has already picked one by hand.

(This list predates the preset library, the custom shape editor, and mobile support,
none of which it describes — treat it as a historical starting spec, not current UI
inventory. The three bullets above are the exception, added when those features
shipped.)

## Constraints

- Output SVG must be exactly `π × D` × wall height in mm so rotary software imports 1:1
- Seamless wrap in X is a hard requirement — verify by tiling the preview 2× and inspecting
- Presets are original designs. Do not add brand logos or trade dress; the cans are just
  the substrate.
