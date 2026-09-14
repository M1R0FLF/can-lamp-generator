# Measurement harness

Runs the real engine inside the preinstalled Chromium and prints numbers. The engine
is not portable to bare Node: `FieldCtx` and `photo.ts` both build fields through an
actual Canvas2D, which is the entire point of the port plan in `CLAUDE.md` (Canvas
rasterizes in C instead of shipping numpy). So a faithful measurement needs a browser.

```
npm run measure:baseline                                  # per-preset checksums
npm run measure tools/measure/mtf.mjs                     # modulation transfer + reconstruction error
npm run measure tools/measure/dither.mjs                  # tone fidelity + uniformity
npm run measure tools/measure/seam.mjs                    # wrap at x=0/W (CLAUDE.md rule 1)
npm run measure:render                                    # lit/unlit PNGs into ./render-out
node tools/measure/calibration-tile.mjs out.svg           # one real can cut, to settle Ø/web/heat
node tools/measure/bottle-tile.mjs OUTDIR                 # CO2-on-glass calibration wrap (see below)
node tools/measure/run.mjs tools/measure/bottle-dot-test.mjs out.svg   # pitch x density glass test
node tools/measure/run.mjs tools/measure/bottle-figure.mjs OUT  # a real design as dots on a bottle
node tools/measure/run.mjs tools/measure/bottle-scatter-test.mjs OUT MIRO  # random shapes + a label
```

`bottle-tile.mjs` is the odd one out: it is not a measurement of our engine but a
**calibration job for a substrate we do not support yet**. Dark glass marked with a
CO2 laser breaks the tool's founding assumption that a hole is an absence of material
— nothing is removed, so contrast is angular (specular vs diffuse) rather than
radiometric, and every open-area constant in the codebase loses its meaning. It emits
a raster PNG (the right format for a gantry CO2 like the P2S, where thousands of tiny
vector circles would be thousands of accel/decel cycles) plus a small vector SVG for
the line-mode score comparison. Run it, cut it, read the five answers off it. Until
those exist, any constant written for a glass mode would be invented.

`bottle-dot-test.mjs` is the quick one, and the one to reach for first — a full grid
test is what shattered the first bottle. Twenty patches at ONE power setting, about 2% of
the wrap marked, with both axes engraved on the glass so a photographed result is
self-describing.

Its axes are what is left after three others were deleted for measuring nothing. **Dot
size** cannot vary when scoring: the beam traces a path barely larger than its own spot,
so every drawn diameter lands as one 0.15 x 0.2mm mark, and rule 5's AM half is simply
unavailable on glass. **Power** came out once it was known. What remains is pitch against
density — pitch sets the ceiling (one spot over one hex cell, which at the can's 1.45mm is
2.5% against the can's own 11.67%, so matching the can needs about 0.56mm), and density
places a tone within it. If density does not read once frosted, glass gets line art and
nothing else.

It runs through the harness rather than standing alone because that density decision has
to be the **engine's**. A first cut screened it with a closed-form sine hash and the 50%
and 25% patches came out visibly streaky — rule 10's chaining, which would have been read
as "density looks blotchy on glass" when it was the test's own screen doing it.
`bluenoise.ts` exists to fix exactly that, so the test uses it. Labels are seven-segment
strokes rather than SVG `<text>`, because a `<text>` element needs the importing software
to resolve a font, and when it cannot the label vanishes or arrives as a blob — which you
find out with the bottle already in the machine.

## Run baseline before and after any sampler change

`baseline.mjs` prints a hole count, measured min web, open area and an order-independent
position checksum for all 21 presets. The presets are tuned artwork and the checksums
are the proof that a change to `stipple.ts` was additive rather than a restyle. If a
checksum moves and you did not intend it to, stop.

The one gotcha found the hard way: hole coordinates must stay `Float64`. Staging them
through a `Float32Array` moves every hole by a few nanometres — invisible on the can,
but it breaks the bit-identical property that makes the checksums worth anything.

## The 1x1 field trick

`stipple()` clamps its sampled pixel index into range, so passing a **1×1** field makes
every candidate point read the same value regardless of geometry. That is what makes an
open-area response curve cheap (33 runs over ~16k points) *and* honest — it measures the
real sampler, with its real grid, jitter, dither and size curve, rather than a model of
it. `response.ts` is built on this.

## Look at the pictures

`render.mjs` writes lit and unlit PNGs. Reach for it whenever the question is
compositional. `CLAUDE.md` rule 8 says outright that there is no numeric check for
"too much fussy detail", and rule 4's halo corollary exists because the metrics pointed
one way and the renders settled it the other. Two synthetic sources are built in: a
test chart (ramp, flat patches, shrinking stripe packs, shaded sphere, 1-4mm detail) and
a shaded head-and-shoulders form for "does a subject still read". The Organic pattern
was dropped on exactly this evidence after the metrics had cleared it.

One more warning from experience: sanity-check that a comparison is actually comparing
different things. An edit to `seam.mjs` once left a stale element in its config tuples,
so every row silently destructured an invalid `dither`, fell back to the default, and
printed three identical rows as a clean result.

`bottle-scatter-test.mjs` is the mixed-content one: seven random shapes from the library
at assigned sizes (22 down to 10mm, straddling rule 3's 16mm floor) plus a text label,
in the engine's normal **hybrid** mode with dot Ø varying 0.20-0.45mm.

That mode choice is a reversal. Every earlier glass test ran FM at one fixed dot size,
reasoning that a scored dot is one spot wide whatever diameter is drawn. A real cut said
otherwise — diameter does come through — so the size axis is back and rule 5's AM half is
available on glass after all. The FM-only tests remain valid for what they measured; they
were just built on a premise the bench overturned.

Two placement bugs worth remembering, both caught by rendering rather than by reading the
code. Sizes must be **assigned** rather than sampled: drawing a random size and rejecting
placements that do not fit biases hard against the big ones, and a request for 10-22mm
delivered seven shapes of 10-12. And the label's keep-out has to be its **actual box**,
not a full-width band: on an 84mm panel a reserved band leaves nowhere for a 22mm shape
to stand, and only two of seven placed.
