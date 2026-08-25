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
```

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
