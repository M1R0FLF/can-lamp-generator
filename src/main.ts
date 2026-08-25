import './style.css';
import { inject as injectAnalytics } from '@vercel/analytics';
import {
  generate,
  GenerateResult,
  SourceSpec,
  CanSpec,
  resultToSvg,
  photoFieldCtx,
  DESIGN_HEIGHT_MM,
  AnnotationSpec,
} from './engine/generate';
import {
  PhotoParams,
  PhotoPlacement,
  PhotoSource,
  PhotoFit,
  solveAutoPunch,
  SeamMode,
  DEFAULT_PHOTO_PARAMS,
  DEFAULT_PLACEMENT,
  PHOTO_STIPPLE,
  sampleImage,
  placementFor,
} from './engine/photo';
import { PRESETS, getPreset } from './engine/presets';
import {
  PortraitParams,
  DEFAULT_PORTRAIT_PARAMS,
  DEFAULT_HEAD_HEIGHT_FRAC,
  PORTRAIT_PLACEMENT,
  PORTRAIT_STIPPLE,
  PORTRAIT_QUALITY,
  faceWidthFor,
} from './engine/portrait';
import {
  FaceBox,
  findFace,
  framingFor,
  loadFaceFinder,
  faceWidthOnCan,
} from './engine/faceFind';
import { GENERATORS, DEFAULT_GENERATOR_ID, getGenerator } from './engine/generators';
import { Hole, StippleMode, StippleParams, DEFAULT_STIPPLE } from './engine/stipple';
import { renderGlow } from './engine/glow';
import { createCan3D, CAN_STYLES, Can3D } from './render3d';
import {
  CustomShape,
  makeShape,
  starterShapes,
  isFullWidth,
  canRotate,
  alignShapes,
  AlignMode,
  distributeAround,
  distributeVertical,
  mirrorShapes,
  duplicateShapes,
  ringArray,
  nudgeShapes,
  CUSTOM_STIPPLE,
} from './engine/customShapes';
import {
  SHAPE_CATEGORIES,
  ShapeCategory,
  shapesInCategory,
  getShapeDef,
} from './engine/shapes/library';
import {
  QUALITY_PRESETS,
  DEFAULT_QUALITY_INDEX,
  DEFAULT_MIN_WEB_TARGET,
  DEFAULT_LASER_SPEED,
  DEFAULT_LASER_PASSES,
  DEFAULT_OPEN_AREA_MIN_PCT,
  DEFAULT_OPEN_AREA_MAX_PCT,
  estimateCutSeconds,
} from './engine/qualityPresets';
import { CAN_SIZES, DEFAULT_CAN, clampCan, aspectWarning, matchCanSize } from './engine/canSizes';

const PPM_DRAFT = 4;
const PPM_FULL = 7;
// Fixed px/mm for the flat preview — NOT fit-to-container. A can with a
// bigger diameter is just a wider image; the wrapper scrolls horizontally
// (CLAUDE.md-adjacent lesson: shrinking-to-fit made large cans unreadable).
const FLAT_SP = 4.6;

type SourceKind = 'preset' | 'custom' | 'photo';
type HoleMode = 'varying' | 'fixed';
type PreviewMode = 'lit' | 'unlit' | 'field';
type ViewMode = 'both' | 'flat' | 'can';
type AnnotationAnchor = AnnotationSpec['yAnchor'];

interface State {
  diameterMm: number;
  heightMm: number;
  sourceKind: SourceKind;
  presetId: string;
  qualityIndex: number;
  holeMode: HoleMode;
  /** id from GENERATORS: which grid+dither pair the sampler runs */
  generatorId: string;
  fixedDiameter: number;
  /** stipple overrides the user has explicitly touched */
  overrides: Partial<StippleParams>;
  minWebTarget: number;
  laserSpeed: number;
  laserPasses: number;
  previewMode: PreviewMode;
  viewMode: ViewMode;
  tile2x: boolean;
  turns: number;
  shapes: CustomShape[];
  selectedIds: Set<string>;
  paletteCategory: ShapeCategory;
  /** which band of the 142mm reference design shows on a shorter can: 0=bottom, 1=top */
  panY: number;
  canStyleId: string;
  /** empty string = no annotation drawn, on either preset or custom sources */
  annotationText: string;
  annotationXFrac: number;
  annotationYAnchor: AnnotationAnchor;
  annotationYOffsetMm: number;
  annotationSizeMm: number;
  ledHoleEnabled: boolean;
  ledHoleDiameterMm: number;
  /** decoded upload; null until the user actually picks a file */
  photoImage: ImageBitmap | null;
  photoName: string;
  photoPlacement: PhotoPlacement;
  photoParams: PhotoParams;
  /**
   * Which pipeline the loaded image goes through. A face and a picture want
   * genuinely different processing (see portrait.ts), so this is a real fork
   * rather than a preset of the same one. Set from detection on load, then the
   * user's to override.
   */
  photoMode: 'portrait' | 'photo';
  portraitParams: PortraitParams;
  /** last detection, in source-image pixels. null = none found. */
  faceBox: FaceBox | null;
  /** head height as a fraction of wall height, the framing's main control */
  headHeightFrac: number;
}

const state: State = {
  diameterMm: DEFAULT_CAN.diameterMm,
  heightMm: DEFAULT_CAN.heightMm,
  sourceKind: 'preset',
  presetId: PRESETS[0].id,
  qualityIndex: DEFAULT_QUALITY_INDEX,
  holeMode: 'varying',
  generatorId: DEFAULT_GENERATOR_ID,
  fixedDiameter: 0.35,
  overrides: {},
  minWebTarget: DEFAULT_MIN_WEB_TARGET,
  laserSpeed: DEFAULT_LASER_SPEED,
  laserPasses: DEFAULT_LASER_PASSES,
  previewMode: 'lit',
  viewMode: 'both',
  tile2x: false,
  turns: 0,
  shapes: starterShapes(),
  selectedIds: new Set<string>(),
  paletteCategory: 'basic',
  panY: 0,
  canStyleId: CAN_STYLES[0].id,
  annotationText: '',
  annotationXFrac: 0.5,
  annotationYAnchor: 'center',
  annotationYOffsetMm: 0,
  annotationSizeMm: 16,
  ledHoleEnabled: false,
  // 3mm cable (per spec) + ~0.4mm clearance so it actually slides through
  // 0.1mm aluminium plus any grommet — tune in Advanced if that's too tight
  // or too loose once you've test-cut one.
  ledHoleDiameterMm: 3.4,
  photoImage: null,
  photoName: '',
  photoPlacement: { ...DEFAULT_PLACEMENT },
  photoParams: { ...DEFAULT_PHOTO_PARAMS },
  photoMode: 'portrait',
  portraitParams: { ...DEFAULT_PORTRAIT_PARAMS },
  faceBox: null,
  headHeightFrac: DEFAULT_HEAD_HEIGHT_FRAC,
};

let result: GenerateResult | null = null;

/**
 * Memoized resample of the uploaded photo.
 *
 * `sampleImage()` is the expensive half of the photo pipeline (a full-canvas
 * drawImage plus a getImageData over every field pixel), and photo.ts splits
 * it out from `buildPhotoField()` precisely so that dragging a *tone* slider
 * doesn't redo it. That split only pays off if the result is actually reused,
 * and the natural call pattern here would defeat it twice over: every
 * `draftThenFull()` generates at PPM_DRAFT and then again at PPM_FULL, and
 * every tone slider fires a fresh `regenerate()`.
 *
 * So the key covers exactly what the resample depends on — the image itself,
 * the pixel grid it lands on, and the placement — and nothing that only
 * affects tone. `photoSeq` stands in for image identity: a fresh upload of a
 * different file at the same size and placement would otherwise produce an
 * identical key and hand back the previous picture's pixels.
 */
let photoCache: { key: string; src: PhotoSource } | null = null;
let photoSeq = 0;

function photoSourceFor(can: CanSpec): PhotoSource | null {
  if (!state.photoImage) return null;
  const ctx = photoFieldCtx(can);
  const p = state.photoPlacement;
  const key = [photoSeq, ctx.Wp, ctx.Hp, p.fit, p.seam, p.zoom, p.offsetX, p.offsetY, p.coverage].join('|');
  if (photoCache && photoCache.key === key) return photoCache.src;
  const src = sampleImage(state.photoImage, ctx, p);
  photoCache = { key, src };
  return src;
}

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const setText = (id: string, v: string) => {
  const n = document.getElementById(id);
  if (n) n.textContent = v;
};

// ---------- preset list ----------
const presetSelect = el<HTMLSelectElement>('preset');
{
  const groups = new Map<string, typeof PRESETS>();
  for (const p of PRESETS) {
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group)!.push(p);
  }
  for (const [group, items] of groups) {
    const og = document.createElement('optgroup');
    og.label = group;
    for (const p of items) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      og.appendChild(opt);
    }
    presetSelect.appendChild(og);
  }
  presetSelect.value = state.presetId;
}

// ---------- dot pattern picker ----------
// Built from GENERATORS rather than written into index.html, so the catalogue
// and its measured justifications stay in one file.
// Set once the user picks a pattern by hand, so loading a photo stops
// overriding them. Without it, choosing Classic for a photo and then loading a
// different crop would silently snap back to Detail.
let generatorTouched = false;

// Set once the user moves the Punch slider, so auto-Punch stops overriding a
// choice they made with the render in front of them.
let punchTouched = false;

// Set once the user picks face-vs-picture by hand, so detection on the next
// upload stops overriding them.
let photoModeTouched = false;

function buildGeneratorPicker() {
  const seg = el('generatorSeg');
  seg.innerHTML = '';
  for (const g of GENERATORS) {
    const b = document.createElement('button');
    b.dataset.gen = g.id;
    b.textContent = g.name;
    b.classList.toggle('active', g.id === state.generatorId);
    seg.appendChild(b);
  }
}

/**
 * Portrait params with `faceWidthMm` filled in from the live geometry.
 *
 * Kept out of `state.portraitParams` deliberately: the face's width ON THE CAN
 * is derived from the detection, the placement and the can's own size, so
 * storing it would mean three ways to get it stale (change the diameter, drag
 * zoom, load a new photo). The tone stage needs it to set the identity band's
 * scale, so it is computed at use.
 *
 * With no detection it falls back to estimating from the placement, which is
 * roughly right for a portrait-shaped photo and the reason `faceWidthFor`
 * still exists.
 */
function portraitParamsForCan(can: CanSpec): PortraitParams {
  const ctx = photoFieldCtx(can);
  const img = state.photoImage;
  const faceWidthMm =
    state.faceBox && img
      ? faceWidthOnCan(state.faceBox, state.photoPlacement, img.width, img.height, ctx.W, ctx.H, can.ppm)
      : faceWidthFor(state.photoPlacement, ctx.W, ctx.H);
  return { ...state.portraitParams, faceWidthMm };
}

/**
 * Re-solve the crop from the current detection and head-size setting.
 *
 * Separate from loading so that changing the head-size slider, or the can's
 * dimensions, re-frames without re-running detection.
 */
function reframeOnFace(): boolean {
  const img = state.photoImage;
  if (!img || !state.faceBox) return false;
  const can: CanSpec = { diameterMm: state.diameterMm, heightMm: state.heightMm, ppm: PPM_FULL };
  const ctx = photoFieldCtx(can);
  state.photoPlacement = framingFor(
    state.faceBox, img.width, img.height, ctx.W, ctx.H, can.ppm, state.headHeightFrac
  );
  return true;
}

// ---------- resolve the stipple params in play ----------
function effectiveStipple(): StippleParams {
  // Gated on an image actually being loaded, not just on the tab being open:
  // with no image `regenerate()` falls back to rendering the preset, so the
  // stipple params have to fall back in step or the preview would be sampled
  // with photo tuning (knee 0.95) while showing preset artwork.
  const designPart =
    state.sourceKind === 'photo' && state.photoImage
      ? (state.photoMode === 'portrait' ? PORTRAIT_STIPPLE : PHOTO_STIPPLE) :
    state.sourceKind === 'custom' ? CUSTOM_STIPPLE :
    getPreset(state.presetId).stipple;
  // The face pipeline has its own quality ladder — see PORTRAIT_QUALITY. It has
  // to be consulted HERE rather than layered under the design tuple, because
  // the quality part is applied after it and would otherwise overwrite the
  // portrait pitch with a preset one, throwing away the pipeline's single most
  // important variable.
  const portraitMode =
    state.sourceKind === 'photo' && !!state.photoImage && state.photoMode === 'portrait';
  let qualityPart: Partial<StippleParams> = {};
  if (portraitMode) {
    const q = PORTRAIT_QUALITY[Math.min(PORTRAIT_QUALITY.length - 1, state.qualityIndex)];
    qualityPart = { pitchMm: q.pitch, dMin: q.dMin, dMax: q.dMax, jitter: q.jitter, rowShift: q.rowShift };
  } else {
    const q = QUALITY_PRESETS[state.qualityIndex];
    if (q) qualityPart = { pitchMm: q.pitch, dMin: q.dMin, dMax: q.dMax, jitter: q.jitter };
  }
  // The generator sits between the design's own tuning and the user's explicit
  // Advanced overrides: it is a deliberate choice, so it beats a preset's
  // default, but it only carries `grid`/`dither` and must not shadow anything
  // the user typed by hand.
  const gen = getGenerator(state.generatorId);
  const base: StippleParams = {
    ...DEFAULT_STIPPLE,
    ...designPart,
    ...qualityPart,
    dither: gen.dither,
    ...state.overrides,
  };
  if (state.holeMode === 'fixed') {
    base.mode = 'fm';
    base.fixedDiameterMm = state.fixedDiameter;
  } else if (base.mode === 'fm') {
    base.mode = 'hybrid';
  }
  return base;
}

// ---------- generation ----------
function regenerate(ppm: number) {
  const can: CanSpec = {
    diameterMm: state.diameterMm,
    heightMm: state.heightMm,
    ppm,
    panY: state.panY,
    ledHole: {
      enabled: state.ledHoleEnabled,
      diameterMm: state.ledHoleDiameterMm,
    },
  };
  // With the photo tab open but no file chosen yet, fall through to the preset
  // rather than rendering an empty can — the pane's own empty state is what
  // explains the situation, and a blank preview looks like a broken app.
  // effectiveStipple() gates on the same condition so the two stay consistent.
  const photoSrc = state.sourceKind === 'photo' ? photoSourceFor(can) : null;
  const source: SourceSpec =
    state.sourceKind === 'custom' ? { kind: 'custom', shapes: state.shapes }
    : photoSrc
      ? state.photoMode === 'portrait'
        ? { kind: 'portrait', source: photoSrc, params: portraitParamsForCan(can) }
        : { kind: 'photo', source: photoSrc, params: state.photoParams }
    : { kind: 'preset', presetId: state.presetId };
  const annotation: AnnotationSpec | undefined = state.annotationText.trim()
    ? {
        text: state.annotationText.trim(),
        xFrac: state.annotationXFrac,
        yAnchor: state.annotationYAnchor,
        yOffsetMm: state.annotationYOffsetMm,
        sizeMm: state.annotationSizeMm,
      }
    : undefined;
  result = generate(can, source, effectiveStipple(), annotation);
  renderCropRail();
  renderReadout();
  renderPreviews();
  // The small editor canvas's WYSIWYG background is a snapshot of THIS
  // result.field, taken separately from the big preview. Centralized here
  // rather than left to each caller: two different call sites already forgot
  // it independently (dropping a new shape from the palette, then dragging
  // an existing one to reposition it — "only the contour appears at the new
  // place and the old shape remains" until something else happened to
  // trigger a redraw). Every regenerate() now keeps it in sync by
  // construction, so a third call site can't reintroduce the same bug.
  if (state.sourceKind === 'custom') renderEditor();
}

/**
 * Put the crop rail wherever the thing it annotates actually is.
 *
 * On wide screens it sits beside the flat preview. Phones hide that pane
 * (effectiveViewMode), which would strand the ONLY control for choosing which
 * band of the 142mm design lands on a shorter can — so on the stacked layout
 * the rail moves next to the 3D can instead. You lose the preview of what is
 * being cropped away, but you keep the choice.
 *
 * This moves the one existing element rather than adding a second slider, so
 * there is still a single #panY input and the existing handler is untouched.
 */
function placeCropRail() {
  const stacked = isStacked();
  const move = (node: HTMLElement, selector: string) => {
    const target = document.querySelector(selector);
    if (target && node.parentElement !== target) target.appendChild(node);
  };
  move(el('cropRail'), stacked ? '.can-row' : '.flat-row');
  // The readout lives in .flat-foot, which is inside the hidden flat pane — a
  // slider with no indication of the range it keeps is not much of a control.
  move(el('cropReadout'), stacked ? '#canBlock' : '.flat-foot');
}

function renderCropRail() {
  placeCropRail();
  const cw = result?.cropWindow ?? null;
  el('cropRail').style.display = cw ? 'flex' : 'none';
  el<HTMLCanvasElement>('flatCanvas').classList.toggle('croppable', !!cw);
  if (cw && result) {
    // On phones there is no lit band to drag — only the slider — so the hint
    // must not tell you to drag something that isn't on screen.
    const how = isStacked() ? 'use the slider' : 'drag the lit band or the slider';
    setText(
      'cropReadout',
      `Keeping ${cw.fromMm.toFixed(0)}–${cw.toMm.toFixed(0)} mm of the ${result.designH.toFixed(0)} mm design — ${how}`
    );
  } else {
    setText('cropReadout', '');
  }
}

// ---------- readout ----------
function formatDuration(sec: number): string {
  if (sec < 60) return `${sec.toFixed(1)} s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}m ${s}s`;
  }
  const totalMin = Math.round(sec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

function renderReadout() {
  if (!result) {
    setText('roHoleCount', '—');
    setText('roMinWeb', '—');
    return;
  }
  const r = result;
  setText('roCanvas', `${r.W.toFixed(1)} × ${r.H.toFixed(1)} mm`);
  setText('roGrid', `${r.cols} × ${r.rows}`);
  setText('roHoleCount', r.holes.length.toLocaleString());

  const minWebEl = el('roMinWeb');
  minWebEl.textContent = Number.isFinite(r.minWeb) ? `${r.minWeb.toFixed(3)} mm` : '—';
  minWebEl.className = 'value ' + (r.minWeb < state.minWebTarget ? 'danger' : 'ok');

  let area = 0;
  for (const h of r.holes) area += Math.PI * h.r * h.r;
  const openAreaPct = (100 * area) / (r.W * r.H);
  const openAreaEl = el('roOpenArea');
  openAreaEl.textContent = `${openAreaPct.toFixed(1)} %`;
  const openAreaOk = openAreaPct >= DEFAULT_OPEN_AREA_MIN_PCT && openAreaPct <= DEFAULT_OPEN_AREA_MAX_PCT;
  openAreaEl.className = 'value ' + (openAreaOk ? 'ok' : 'danger');
  openAreaEl.title = openAreaOk
    ? ''
    : openAreaPct < DEFAULT_OPEN_AREA_MIN_PCT
      ? `Under ${DEFAULT_OPEN_AREA_MIN_PCT}% — reads as mostly black/empty (CLAUDE.md rule 8)`
      : `Over ${DEFAULT_OPEN_AREA_MAX_PCT}% — leaves no dark ground for contrast (CLAUDE.md rule 8)`;
  setText('roCutTime', formatDuration(estimateCutSeconds(r.holes.length, state.laserSpeed, state.laserPasses)));
  setText('roGenTime', `${(r.buildMs + r.sampleMs).toFixed(0)} ms`);
}

// ---------- previews ----------
function dotsCanvas(holes: Hole[], W: number, H: number, sp: number, tiles: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(W * sp * tiles);
  c.height = Math.round(H * sp);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#fff';
  for (let t = 0; t < tiles; t++) {
    const dx = t * W * sp;
    for (const h of holes) {
      ctx.beginPath();
      ctx.arc(h.x * sp + dx, h.y * sp, Math.max(0.45, h.r * sp), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return c;
}

function unlitCanvas(holes: Hole[], W: number, H: number, sp: number, tiles: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(W * sp * tiles);
  c.height = Math.round(H * sp);
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, '#b3afab');
  grad.addColorStop(0.5, '#928e8a');
  grad.addColorStop(1, '#a8a4a0');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#26251f';
  for (let t = 0; t < tiles; t++) {
    const dx = t * W * sp;
    for (const h of holes) {
      ctx.beginPath();
      ctx.arc(h.x * sp + dx, h.y * sp, Math.max(0.45, h.r * sp), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return c;
}

function fieldCanvas(r: GenerateResult, sp: number, tiles: number): HTMLCanvasElement {
  const src = document.createElement('canvas');
  src.width = r.Wp;
  src.height = r.Hp;
  const sctx = src.getContext('2d')!;
  const img = sctx.createImageData(r.Wp, r.Hp);
  for (let i = 0; i < r.field.length; i++) {
    const v = Math.round(Math.min(1, Math.max(0, r.field[i])) * 255);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);

  // `field` is always stored at design height, so scale to that — not the can
  // height, which would squash it whenever a crop is in play.
  const c = document.createElement('canvas');
  c.width = Math.round(r.W * sp * tiles);
  c.height = Math.round(r.designH * sp);
  const ctx = c.getContext('2d')!;
  for (let t = 0; t < tiles; t++) {
    ctx.drawImage(src, t * r.W * sp, 0, r.W * sp, r.designH * sp);
  }
  return c;
}

let can3d: Can3D | null = null;

/** Transparent-background overlay: dark filled circles at hole positions,
 * for compositing over a colored can body in unlit 3D mode (the flat unlit
 * preview instead paints an opaque aluminum-gradient background, which would
 * hide the body color entirely). */
function unlitOverlay(holes: Hole[], W: number, H: number, sp: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(W * sp);
  c.height = Math.round(H * sp);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(15,13,10,0.85)';
  for (const h of holes) {
    ctx.beginPath();
    ctx.arc(h.x * sp, h.y * sp, Math.max(0.45, h.r * sp), 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/**
 * Draw the LED wire-hole notch as a flat, non-glowing D-shape — deliberately
 * NOT run through renderGlow. Once assembled a wire fills this opening and
 * blocks the light it would otherwise pass, so showing it as a bright glow
 * dot (like every stipple hole) misrepresents the finished lamp; the fix is
 * to leave it out of the glow pipeline entirely, not dim it. Still drawn in
 * Unlit/Field, where it IS honestly an opening in bare metal.
 *
 * `yFlatMm` is where the physical can's bottom edge falls in THIS canvas's
 * own coordinate space — same value `overlayCrop` uses for its "kept" edge
 * (`designH - fromMm`, which is just `H` when nothing is cropped), so the
 * notch lines up with the crop-window outline rather than needing its own
 * separate derivation.
 */
function drawLedNotch(
  canvas: HTMLCanvasElement,
  notch: { x: number; r: number },
  yFlatMm: number,
  W: number,
  sp: number,
  tiles: number,
  unlit: boolean,
  alpha = 1
) {
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = unlit ? '#141311' : '#000';
  ctx.strokeStyle = unlit ? '#4a463f' : '#333';
  ctx.lineWidth = Math.max(1, 0.12 * notch.r * sp);
  const cy = yFlatMm * sp;
  const R = notch.r * sp;
  for (let t = 0; t < tiles; t++) {
    const cx = (notch.x + t * W) * sp;
    ctx.beginPath();
    // canvas y grows downward, so the default (clockwise) sweep from the left
    // point (angle PI) to the right point (2*PI) passes through the TOP —
    // the semicircle bulging up into the design, away from the excluded area
    // below y=H. Matches the SVG path in svg.ts's notchPath().
    ctx.arc(cx, cy, R, Math.PI, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** Dim the parts of the design the current crop window throws away, and
 * outline the part that survives, so the crop is visible rather than implied. */
function overlayCrop(canvas: HTMLCanvasElement, r: GenerateResult, sp: number) {
  if (!r.cropWindow) return;
  const ctx = canvas.getContext('2d')!;
  // canvas y runs downward from the top of the design
  const keepTopPx = (r.designH - r.cropWindow.toMm) * sp;
  const keepBotPx = (r.designH - r.cropWindow.fromMm) * sp;

  ctx.save();
  ctx.fillStyle = 'rgba(8,9,11,0.76)';
  ctx.fillRect(0, 0, canvas.width, keepTopPx);
  ctx.fillRect(0, keepBotPx, canvas.width, canvas.height - keepBotPx);

  ctx.strokeStyle = 'rgba(224,164,90,0.95)';
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.moveTo(0, keepTopPx);
  ctx.lineTo(canvas.width, keepTopPx);
  ctx.moveTo(0, keepBotPx);
  ctx.lineTo(canvas.width, keepBotPx);
  ctx.stroke();
  ctx.restore();
}

/** Narrow, single-column layout — same breakpoint the control panels use. */
const STACKED_QUERY = '(max-width: 900px)';
const isStacked = () => window.matchMedia(STACKED_QUERY).matches;

/**
 * Which preview panes to actually show.
 *
 * On the stacked (phone) layout the flat/unwrapped view is forced off: at the
 * fixed FLAT_SP of 4.6 px/mm only about a third of the wrap fits on a phone
 * screen, so it is all panning and no overview — not worth the space. The 3D
 * can reads fine at that width, so a phone gets the can only, whatever
 * `state.viewMode` happens to hold from a wider session.
 */
function effectiveViewMode(): ViewMode {
  return isStacked() ? 'can' : state.viewMode;
}

function renderPreviews() {
  if (!result) return;
  const r = result;
  const tiles = state.tile2x ? 2 : 1;
  const sp = FLAT_SP;
  const pane = document.querySelector('main.preview') as HTMLElement | null;
  const view = effectiveViewMode();

  // Skip the flat raster entirely when nothing will show it — renderGlow over
  // the whole wrap is the most expensive thing here.
  if (view !== 'can') {
    // When cropping, the flat view shows the WHOLE design (so you can see what
    // you're choosing between) with the discarded bands dimmed. Otherwise it
    // shows the can content directly.
    const cropping = !!r.cropWindow;
    const flatHoles = cropping ? r.designHoles : r.holes;
    const flatH = cropping ? r.designH : r.H;

    let flat: HTMLCanvasElement;
    if (state.previewMode === 'lit') {
      flat = renderGlow(dotsCanvas(flatHoles, r.W, flatH, sp, tiles), sp);
    } else if (state.previewMode === 'unlit') {
      flat = unlitCanvas(flatHoles, r.W, flatH, sp, tiles);
    } else {
      flat = fieldCanvas(r, sp, tiles);
    }

    const flatCanvas = el<HTMLCanvasElement>('flatCanvas');
    flatCanvas.width = flat.width;
    flatCanvas.height = flat.height;
    flatCanvas.getContext('2d')!.drawImage(flat, 0, 0);
    overlayCrop(flatCanvas, r, sp);
    // Left out of Lit on purpose — see drawLedNotch.
    if (r.ledNotch && state.previewMode !== 'lit') {
      const yFlatMm = cropping ? r.designH - r.cropWindow!.fromMm : r.H;
      drawLedNotch(flatCanvas, r.ledNotch, yFlatMm, r.W, sp, tiles, state.previewMode === 'unlit');
    }

    // keep the rail's track the same height as the preview it annotates
    el('cropRail').style.height = `${flat.height}px`;
  }

  // the 3D view always wraps a single (untiled) copy, at its own resolution
  const texSp = Math.max(3, Math.min(6, 700 / r.W));
  const lit = state.previewMode === 'lit';
  const texture = lit
    ? renderGlow(dotsCanvas(r.holes, r.W, r.H, texSp, 1), texSp)
    : unlitOverlay(r.holes, r.W, r.H, texSp);
  // unlitOverlay is transparent-background, composited over the coloured can
  // body — draw the notch into that same overlay so it isn't lost against it.
  // Left out of `lit` on purpose, same as the flat view; see drawLedNotch.
  if (r.ledNotch && !lit) {
    // 0.85 alpha matches unlitOverlay's own hole-dot fill, so the notch reads
    // as part of the same texture rather than a harder-edged patch on top.
    drawLedNotch(texture, r.ledNotch, r.H, r.W, texSp, 1, true, 0.85);
  }

  if (can3d) {
    // give the can whatever vertical room the pane actually has, so "3D only"
    // fills the view instead of needing a scroll
    // 250px covers the toolbar, block heading, rotate row, hint and padding
    // that sit around the stage, so "3D only" fits without a scrollbar
    const paneH = pane?.clientHeight ?? 600;
    // "Both" used to hard-cap at 520 regardless of available space. The pane
    // scrolls (main.preview has overflow-y:auto), so a taller can here isn't
    // a hard layout risk the way running out of horizontal room would be —
    // 680 gives it real room to grow instead of a token bump.
    const maxHeightPx = view === 'can' ? Math.max(260, paneH - 250) : 680;
    const stacked = isStacked();
    can3d.update({
      texture,
      lit,
      style: CAN_STYLES.find((s) => s.id === state.canStyleId) ?? CAN_STYLES[0],
      diameterMm: state.diameterMm,
      heightMm: state.heightMm,
      maxHeightPx,
      // Match the flat preview's own rendered width so the two visibly line
      // up and the can gets to be as big as the pattern next to it, instead
      // of stuck at whatever mount.clientWidth's circular fallback picks
      // (see the comment in render3d.ts). Skipped when stacked: the mobile
      // layout already fits the mount to the (narrow) viewport correctly,
      // and the flat pane's own width there is much wider than the screen
      // (it pans, per effectiveViewMode) — forcing the can to match THAT
      // would blow out the phone layout instead of fixing anything.
      widthPx: stacked ? undefined : Math.round(r.W * sp),
      ledNotch: r.ledNotch,
    });
    // Stacked, the rail annotates the CAN, not the flat pane whose height the
    // branch above would normally have set — so match the stage instead.
    if (isStacked()) {
      const stage = el('can3dMount').firstElementChild as HTMLElement | null;
      const h = stage?.clientHeight || el('can3dMount').clientHeight;
      if (h > 0) el('cropRail').style.height = `${h}px`;
    }
  }
}

function applyViewMode() {
  const view = effectiveViewMode();
  el('flatBlock').style.display = view === 'can' ? 'none' : 'block';
  el('canBlock').style.display = view === 'flat' ? 'none' : 'block';
  // The Both/Flat/3D toggle is meaningless when the flat pane is forced off, so
  // the stacked layout hides it (CSS) — keep the buttons in sync regardless, so
  // the right one is lit when the window widens again.
  for (const b of el('viewSeg').querySelectorAll('button')) {
    b.classList.toggle('active', (b as HTMLElement).dataset.view === state.viewMode);
  }
}

// ---------- input sync ----------
function syncInputs() {
  const s = effectiveStipple();
  const set = (id: string, v: string) => {
    const n = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    // Never overwrite the field the user is actively typing into. numInput()
    // calls syncInputs() on every keystroke so OTHER fields' derived/clamped
    // values stay live — but doing that to the focused field itself fights
    // the user's own typing: type "5" of an intended "50" into height
    // (min 30, max 260), it clamps to "30" mid-keystroke, the next keystroke
    // "0" lands after it making "300", which then clamps to the max, 260.
    // numInput() re-syncs explicitly on 'change' (blur/commit), so the
    // clamped value still shows the moment the field is no longer focused.
    if (n && n !== document.activeElement) n.value = v;
  };
  set('diameter', String(state.diameterMm));
  set('height', String(state.heightMm));
  set('quality', String(state.qualityIndex));
  set('preset', state.presetId);
  set('fixedDiameter', state.fixedDiameter.toFixed(2));
  set('pitch', s.pitchMm.toFixed(2));
  set('dMin', s.dMin.toFixed(2));
  set('dMax', s.dMax.toFixed(2));
  set('jitter', s.jitter.toFixed(2));
  set('thresh', s.thresh.toFixed(2));
  set('knee', s.knee.toFixed(2));
  set('stippleGamma', s.gamma.toFixed(2));
  set('toneMode', s.mode);
  {
    const gen = getGenerator(state.generatorId);
    setText('generatorLabel', gen.name);
    // AM carries tone purely in hole size, so there is no density decision for
    // a dither to make and all three patterns come out identical. That is
    // correct, but it looks broken — and the default preset (Mango Salvaje) is
    // the one AM design in the library, so it is the first thing a new user
    // clicks. Say so rather than letting the buttons appear dead.
    setText(
      'generatorHint',
      s.mode === 'am'
        ? `${gen.hint} Note: this design sets tone by hole size alone (Advanced → Tone mode: AM), ` +
          'so the dot pattern makes no difference here. Switch Tone mode to Hybrid to use it.'
        : gen.hint
    );
    for (const b of el('generatorSeg').querySelectorAll('button')) {
      b.classList.toggle('active', (b as HTMLElement).dataset.gen === state.generatorId);
    }
  }
  set('minWebTarget', state.minWebTarget.toFixed(2));
  set('laserSpeed', String(state.laserSpeed));
  set('laserPasses', String(state.laserPasses));
  set('panY', String(state.panY));
  set('annotationText', state.annotationText);
  set('annotationX', String(state.annotationXFrac));
  set('annotationSize', String(state.annotationSizeMm));
  // Range scales with the actual can height rather than a fixed +/-40mm, so
  // "top"/"bottom" can still reach all the way to the opposite edge on a
  // tall can, and "center" spans exactly bottom-to-top either way — reported
  // as not going "high or low enough" on a can taller than ~80mm.
  const offsetEl = document.getElementById('annotationOffset') as HTMLInputElement | null;
  if (offsetEl) {
    const half = state.heightMm / 2;
    offsetEl.min = String(-half);
    offsetEl.max = String(half);
    // A shorter can can shrink the range below the current value. The range
    // input clamps what it DISPLAYS on its own, but state.annotationYOffsetMm
    // wouldn't otherwise follow — which would silently position the text
    // outside the can while the slider shows something else.
    state.annotationYOffsetMm = Math.min(half, Math.max(-half, state.annotationYOffsetMm));
  }
  set('annotationOffset', String(state.annotationYOffsetMm));
  set('ledHoleDiameter', state.ledHoleDiameterMm.toFixed(1));

  setText('diameterVal', `${state.diameterMm.toFixed(1)} mm`);
  setText('heightVal', `${state.heightMm.toFixed(1)} mm`);

  const matched = matchCanSize(state.diameterMm, state.heightMm);
  const sizeSel = document.getElementById('canSize') as HTMLSelectElement | null;
  if (sizeSel) sizeSel.value = matched ? matched.id : 'custom';
  const warn = aspectWarning(state.diameterMm, state.heightMm);
  const warnEl = document.getElementById('aspectWarn');
  if (warnEl) {
    warnEl.style.display = warn ? 'block' : 'none';
    warnEl.textContent = warn ?? '';
    warnEl.style.color = 'var(--accent)';
  }
  setText('qualityLabel', QUALITY_PRESETS[state.qualityIndex]?.label ?? 'Custom');
  setText('fixedDiameterVal', state.fixedDiameter.toFixed(2));
  setText('pitchVal', s.pitchMm.toFixed(2));
  setText('dMinVal', s.dMin.toFixed(2));
  setText('dMaxVal', s.dMax.toFixed(2));
  setText('jitterVal', s.jitter.toFixed(2));
  setText('threshVal', s.thresh.toFixed(2));
  setText('kneeVal', s.knee.toFixed(2));
  setText('stippleGammaVal', s.gamma.toFixed(2));
  setText('minWebTargetVal', state.minWebTarget.toFixed(2));
  setText('laserSpeedVal', `${state.laserSpeed} mm/s`);
  setText('laserPassesVal', String(state.laserPasses));
  setText('presetDesc', getPreset(state.presetId).description);
  setText('annotationXVal', `${Math.round(state.annotationXFrac * 100)}%`);
  setText('annotationSizeVal', `${state.annotationSizeMm.toFixed(0)} mm`);
  setText('annotationOffsetVal', `${state.annotationYOffsetMm >= 0 ? '+' : ''}${state.annotationYOffsetMm.toFixed(0)} mm`);
  setText('ledHoleDiameterVal', `${state.ledHoleDiameterMm.toFixed(1)} mm`);

  // ---- photo source ----
  const pl = state.photoPlacement;
  const pp = state.photoParams;
  set('photoZoom', String(pl.zoom));
  set('photoCoverage', String(pl.coverage));
  set('photoOffsetX', String(pl.offsetX));
  set('photoOffsetY', String(pl.offsetY));
  set('photoPosterize', String(pp.posterize));
  set('photoGamma', String(pp.gamma));
  {
    const q = state.portraitParams;
    set('portraitHead', String(state.headHeightFrac));
    set('portraitBoost', String(q.identityBoost));
    set('portraitBright', String(q.brightness));
    set('portraitContrast', String(q.contrast));
    set('portraitVig', String(q.vignette));
    set('portraitLevels', String(q.levels));
    setText('portraitHeadVal', `${Math.round(state.headHeightFrac * 100)}% of wall`);
    setText('portraitBoostVal', q.identityBoost.toFixed(2));
    const sg = (v: number) => (v === 0 ? '0' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}`);
    setText('portraitBrightVal', sg(q.brightness));
    setText('portraitContrastVal', sg(q.contrast));
    setText('portraitVigVal', q.vignette.toFixed(2));
    setText('portraitLevelsVal', q.levels >= 2 ? `${Math.round(q.levels)}` : 'smooth');
    for (const b of document.querySelectorAll<HTMLElement>('#photoModeSeg button')) {
      b.classList.toggle('active', b.dataset.photomode === state.photoMode);
    }
    // the two pipelines have disjoint controls; showing both would imply the
    // inactive set is doing something
    const isPortrait = state.photoMode === 'portrait';
    const pProps = document.getElementById('portraitProps');
    if (pProps) pProps.style.display = isPortrait ? 'block' : 'none';
    for (const id of ['photoToneGroup']) {
      const n = document.getElementById(id);
      if (n) n.style.display = isPortrait ? 'none' : 'block';
    }
    const rec = document.getElementById('portraitRecentre') as HTMLButtonElement | null;
    if (rec) {
      rec.disabled = !state.faceBox;
      rec.title = state.faceBox ? '' : 'No face was detected in this photo';
    }
  }
  set('photoBrightness', String(pp.brightness));
  set('photoContrast', String(pp.contrast));
  set('photoLocalContrast', String(pp.localContrast));
  set('photoLocalContrastRadius', String(pp.localContrastRadiusMm));
  set('photoVignette', String(pp.vignette));
  set('photoEdgeBoost', String(pp.edgeBoost));
  set('photoAmbient', String(pp.ambient));
  set('photoBlackPoint', String(pp.blackPoint));
  set('photoWhitePoint', String(pp.whitePoint));
  setText('photoZoomVal', `${pl.zoom.toFixed(2)}×`);
  setText('photoCoverageVal', `${Math.round(pl.coverage * 100)}%`);
  setText('photoOffsetXVal', `${pl.offsetX >= 0 ? '+' : ''}${Math.round(pl.offsetX * 100)}%`);
  setText('photoOffsetYVal', `${pl.offsetY >= 0 ? '+' : ''}${Math.round(pl.offsetY * 100)}%`);
  setText('photoPosterizeVal', pp.posterize >= 2 ? `${Math.round(pp.posterize)} steps` : 'off');
  setText('photoGammaVal', pp.gamma.toFixed(2));
  const signed = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;
  setText('photoBrightnessVal', pp.brightness === 0 ? '0' : signed(pp.brightness));
  setText('photoContrastVal', pp.contrast === 0 ? '0' : signed(pp.contrast));
  setText('photoLocalContrastVal', pp.localContrast.toFixed(2));
  setText('photoLocalContrastRadiusVal', `${pp.localContrastRadiusMm.toFixed(0)} mm`);
  setText('photoVignetteVal', pp.vignette.toFixed(2));
  setText('photoEdgeBoostVal', pp.edgeBoost.toFixed(2));
  setText('photoAmbientVal', pp.ambient.toFixed(2));
  setText('photoBlackPointVal', pp.blackPoint.toFixed(2));
  setText('photoWhitePointVal', pp.whitePoint.toFixed(2));
  for (const b of document.querySelectorAll<HTMLElement>('#photoFitSeg button')) {
    b.classList.toggle('active', b.dataset.fit === pl.fit);
  }
  for (const b of document.querySelectorAll<HTMLElement>('#photoSeamSeg button')) {
    b.classList.toggle('active', b.dataset.seam === pl.seam);
  }
  for (const b of document.querySelectorAll<HTMLElement>('#photoEdgeAwareSeg button')) {
    b.classList.toggle('active', (b.dataset.edgeaware === '1') === pp.localContrastEdgeAware);
  }
  for (const b of document.querySelectorAll<HTMLElement>('#photoAutoLevelsSeg button')) {
    b.classList.toggle('active', (b.dataset.auto === '1') === pp.autoLevels);
  }
  const invertBtn = document.getElementById('photoInvert');
  if (invertBtn) invertBtn.classList.toggle('active', pp.invert);
  const levelsFields = document.getElementById('photoLevelsFields');
  if (levelsFields) levelsFields.style.display = pp.autoLevels ? 'none' : 'flex';
  // 'coverage' only means anything in fade mode — the other two seam modes
  // span the full circumference by construction.
  const covField = document.getElementById('photoCoverage')?.closest('.field') as HTMLElement | null;
  if (covField) covField.style.opacity = pl.seam === 'fade' ? '1' : '0.4';
  setText(
    'photoSeamHint',
    pl.seam === 'fade'
      ? 'Tone fades to black before the seam, so nothing has to line up on the back.'
      : pl.seam === 'mirror'
      ? 'Mirrors one half into the other — the wrap matches exactly, at any diameter.'
      : 'Spans the whole circumference. The left and right edges meet at the back, so pick a photo whose sides are similar.'
  );
}

function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let t: number | undefined;
  return ((...a: any[]) => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => fn(...a), ms);
  }) as T;
}
const fullRegen = debounce(() => regenerate(PPM_FULL), 220);
const draftThenFull = () => {
  regenerate(PPM_DRAFT);
  fullRegen();
};

// ---------- wiring ----------
function numInput(id: string, apply: (v: number) => void, immediate = false) {
  const input = el<HTMLInputElement>(id);
  const run = () => {
    const v = parseFloat(input.value);
    if (!Number.isFinite(v)) return;
    apply(v);
    syncInputs();
    if (immediate) {
      renderReadout();
      renderPreviews();
    } else {
      draftThenFull();
    }
  };
  input.addEventListener('input', run);
  // syncInputs() deliberately skips the focused field (see its comment), so a
  // value clamped by `apply` doesn't visibly correct itself until the field
  // is no longer focused. 'change' fires on blur/commit, after focus has
  // already moved on, so this re-run is what actually shows it.
  input.addEventListener('change', run);
}

numInput('diameter', (v) => {
  state.diameterMm = clampCan(v, state.heightMm).diameterMm;
});
numInput('height', (v) => {
  state.heightMm = clampCan(state.diameterMm, v).heightMm;
});
numInput('fixedDiameter', (v) => (state.fixedDiameter = v));

// ---------- can size catalogue ----------
const canSizeSelect = el<HTMLSelectElement>('canSize');
{
  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.textContent = 'Custom';
  canSizeSelect.appendChild(custom);
  for (const c of CAN_SIZES) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    canSizeSelect.appendChild(opt);
  }
}
canSizeSelect.addEventListener('change', () => {
  const c = CAN_SIZES.find((s) => s.id === canSizeSelect.value);
  if (!c) return;
  state.diameterMm = c.diameterMm;
  state.heightMm = c.heightMm;
  state.panY = 0;
  syncInputs();
  draftThenFull();
});

el<HTMLInputElement>('quality').addEventListener('input', () => {
  state.qualityIndex = parseInt(el<HTMLInputElement>('quality').value, 10);
  // a quality change replaces the geometry tuple, so drop stale overrides of it
  delete state.overrides.pitchMm;
  delete state.overrides.dMin;
  delete state.overrides.dMax;
  delete state.overrides.jitter;
  syncInputs();
  regenerate(PPM_DRAFT);
});
el<HTMLInputElement>('quality').addEventListener('change', () => regenerate(PPM_FULL));

presetSelect.addEventListener('change', () => {
  state.presetId = presetSelect.value;
  // presets carry their own tuned tone params; clear per-design overrides
  state.overrides = {};
  syncInputs();
  draftThenFull();
});

for (const [id, key] of [
  ['pitch', 'pitchMm'],
  ['dMin', 'dMin'],
  ['dMax', 'dMax'],
  ['jitter', 'jitter'],
  ['thresh', 'thresh'],
  ['knee', 'knee'],
  ['stippleGamma', 'gamma'],
] as Array<[string, keyof StippleParams]>) {
  numInput(id, (v) => {
    (state.overrides as any)[key] = v;
  });
}

el<HTMLSelectElement>('toneMode').addEventListener('change', () => {
  state.overrides.mode = el<HTMLSelectElement>('toneMode').value as StippleMode;
  if (state.overrides.mode === 'fm') state.holeMode = 'fixed';
  else state.holeMode = 'varying';
  for (const b of el('holeModeSeg').querySelectorAll('button')) {
    b.classList.toggle('active', (b as HTMLElement).dataset.mode === state.holeMode);
  }
  el('fixedDiameterField').style.display = state.holeMode === 'fixed' ? 'block' : 'none';
  syncInputs();
  draftThenFull();
});

numInput('minWebTarget', (v) => (state.minWebTarget = v), true);
numInput('laserSpeed', (v) => (state.laserSpeed = v), true);
numInput('laserPasses', (v) => (state.laserPasses = Math.round(v)), true);

// ---------- annotation (name/date text, works on preset or custom alike) ----------
function applyAnnotationProps() {
  el('annotationProps').style.display = state.annotationText.trim() ? 'block' : 'none';
}

el<HTMLInputElement>('annotationText').addEventListener('input', (e) => {
  state.annotationText = (e.target as HTMLInputElement).value;
  applyAnnotationProps();
  draftThenFull();
});

el<HTMLInputElement>('annotationX').addEventListener('input', () => {
  state.annotationXFrac = parseFloat(el<HTMLInputElement>('annotationX').value);
  syncInputs();
  draftThenFull();
});

el<HTMLInputElement>('annotationSize').addEventListener('input', () => {
  state.annotationSizeMm = parseFloat(el<HTMLInputElement>('annotationSize').value);
  syncInputs();
  draftThenFull();
});

el<HTMLInputElement>('annotationOffset').addEventListener('input', () => {
  state.annotationYOffsetMm = parseFloat(el<HTMLInputElement>('annotationOffset').value);
  syncInputs();
  draftThenFull();
});

el('annotationAnchorSeg').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  state.annotationYAnchor = (btn as HTMLElement).dataset.anchor as AnnotationAnchor;
  for (const b of el('annotationAnchorSeg').querySelectorAll('button')) b.classList.toggle('active', b === btn);
  draftThenFull();
});

// ---------- LED wire hole ----------
el('ledHoleSeg').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  state.ledHoleEnabled = (btn as HTMLElement).dataset.led === 'on';
  for (const b of el('ledHoleSeg').querySelectorAll('button')) b.classList.toggle('active', b === btn);
  el('ledHoleHint').style.display = state.ledHoleEnabled ? 'block' : 'none';
  draftThenFull();
});

numInput('ledHoleDiameter', (v) => (state.ledHoleDiameterMm = v), true);

// source toggle
//
// Extracted rather than left inline in the click handler because choosing a
// source isn't only something the segmented control does: loading an image
// has to switch to it too, or you drop a file and nothing visible happens
// because the preview is still rendering whichever source was already active.
function setSourceKind(kind: SourceKind) {
  state.sourceKind = kind;
  for (const b of el('sourceSeg').querySelectorAll<HTMLElement>('button')) {
    b.classList.toggle('active', b.dataset.source === kind);
  }
  el('presetPane').style.display = kind === 'preset' ? 'block' : 'none';
  el('customPane').style.display = kind === 'custom' ? 'block' : 'none';
  el('photoPane').style.display = kind === 'photo' ? 'block' : 'none';
  state.overrides = {};
  syncInputs();
  draftThenFull();
  if (kind === 'custom') renderEditor();
}

el('sourceSeg').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  setSourceKind(btn.dataset.source as SourceKind);
});

// ---------- photo source ----------
const photoFileInput = el<HTMLInputElement>('photoFile');

async function loadPhotoFile(file: File | undefined | null) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    setText('photoStatus', `"${file.name}" isn't an image file.`);
    return;
  }
  setText('photoStatus', `Reading ${file.name}…`);
  try {
    // imageOrientation:'from-image' applies the EXIF rotation tag. Phone
    // photos are very often stored landscape with a "rotate 90" tag, and
    // without this they'd come through the resample sideways. The fallback
    // covers browsers that reject the option rather than ignoring it.
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() =>
      createImageBitmap(file)
    );
    state.photoImage?.close?.();
    state.photoImage = bmp;
    state.photoName = file.name;
    photoSeq++;
    photoCache = null;
    // Pick the wrap strategy from the image's own shape rather than making the
    // user discover it. Landscape wraps the whole can; a portrait becomes a
    // front medallion. Re-derived on every upload, since a new picture is a
    // new composition — and announced in the status line so the change to the
    // Fill/seam buttons doesn't look like it happened by itself.
    state.photoPlacement = placementFor(
      bmp.width,
      bmp.height,
      Math.PI * state.diameterMm,
      state.heightMm
    );
    const wrapped = state.photoPlacement.seam === 'stretch';
    setText(
      'photoStatus',
      `${file.name} — ${bmp.width}×${bmp.height}. ` +
        (wrapped
          ? 'Landscape, so it wraps the whole can.'
          : 'Upright, so it sits on the front with the back left dark.')
    );
    el('photoProps').style.display = 'block';

    // ---- is it a face? ----
    //
    // Detection decides which pipeline the image goes through, so it runs on
    // load rather than waiting for the user to pick. The cascade is 234KB and
    // fetched on first use, so a session that only ever renders presets never
    // downloads it.
    //
    // Every failure here is non-fatal by design: a blocked fetch, an offline
    // reload or a photo with no findable face must all still give the user a
    // working picture, so each falls through to the 'photo' pipeline with its
    // own placement rather than throwing.
    state.faceBox = null;
    let faceMsg = '';
    try {
      await loadFaceFinder();
      state.faceBox = findFace(bmp);
      if (state.faceBox) {
        if (!photoModeTouched) state.photoMode = 'portrait';
        state.headHeightFrac = DEFAULT_HEAD_HEIGHT_FRAC;
        reframeOnFace();
        faceMsg = `Face found — framed on it, ${Math.round(state.faceBox.w)}px wide in your photo.`;
      } else {
        if (!photoModeTouched) state.photoMode = 'photo';
        faceMsg = 'No face found, so this is being treated as a picture. Switch to “A face” to force the face pipeline.';
      }
    } catch {
      if (!photoModeTouched) state.photoMode = 'photo';
      faceMsg = "Couldn't load the face detector, so this is being treated as a picture.";
    }
    setText('faceStatus', faceMsg);

    // A photograph wants the Detail pattern, so switch to it on load rather
    // than leaving the user to discover it. Error diffusion holds ~13% more
    // contrast at ~4mm features (measured; see generators.ts) and 4mm is the
    // size of an eye on a can — Classic renders the same face visibly softer.
    // Only moved when the user has not picked a pattern for themselves, so an
    // explicit choice survives loading a second image.
    if (!generatorTouched) state.generatorId = 'detail';
    // Punch (gamma) trades face brightness against face contrast, and the right
    // value is a property of the photograph rather than a constant — measured,
    // two portraits wanted values nearly a factor of two apart. Solve it from
    // the image instead of shipping one compromise. Deferred to the user the
    // moment they touch the slider.
    if (!punchTouched && state.photoMode === 'photo') {
      state.photoParams.gamma = solveAutoPunch(
        bmp, Math.PI * state.diameterMm, state.heightMm,
        state.photoPlacement, state.photoParams, effectiveStipple().pitchMm
      );
    }
    // Loading an image IS choosing the photo source. Without this, dropping a
    // file while the Preset tab is active leaves the preview showing the
    // preset — the upload appears to have silently done nothing.
    // setSourceKind() re-syncs and regenerates, so no separate call here.
    setSourceKind('photo');
  } catch {
    setText('photoStatus', `Couldn't read "${file.name}" — try a JPG or PNG.`);
  }
}

photoFileInput.addEventListener('change', () => {
  void loadPhotoFile(photoFileInput.files?.[0]);
  // Clear the input's value so re-picking the SAME file fires 'change' again;
  // otherwise the second pick is a no-op and the app looks frozen.
  photoFileInput.value = '';
});

{
  const drop = el('photoDrop');
  const openPicker = () => photoFileInput.click();
  drop.addEventListener('click', openPicker);
  drop.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      openPicker();
    }
  });
  // dragover must be prevented too, or the browser navigates to the dropped file
  for (const type of ['dragenter', 'dragover'] as const) {
    drop.addEventListener(type, (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
  }
  for (const type of ['dragleave', 'dragend'] as const) {
    drop.addEventListener(type, () => drop.classList.remove('over'));
  }
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    void loadPhotoFile((e as DragEvent).dataTransfer?.files?.[0]);
  });
}

/** Placement changes invalidate the resample; tone changes don't. */
function photoPlace<K extends keyof PhotoPlacement>(id: string, key: K) {
  numInput(id, (v) => {
    state.photoPlacement[key] = v as PhotoPlacement[K];
  });
}
function photoTone<K extends keyof PhotoParams>(id: string, key: K) {
  numInput(id, (v) => {
    state.photoParams[key] = v as PhotoParams[K];
  });
}

photoPlace('photoZoom', 'zoom');
photoPlace('photoCoverage', 'coverage');
photoPlace('photoOffsetX', 'offsetX');
photoPlace('photoOffsetY', 'offsetY');

photoTone('photoBrightness', 'brightness');
photoTone('photoContrast', 'contrast');
photoTone('photoPosterize', 'posterize');
photoTone('photoGamma', 'gamma');
// Touching Punch hands control back to the user for the rest of the session:
// auto-Punch is a starting point, not a policy.
el('photoGamma').addEventListener('input', () => {
  punchTouched = true;
});
photoTone('photoLocalContrast', 'localContrast');
photoTone('photoLocalContrastRadius', 'localContrastRadiusMm');
photoTone('photoVignette', 'vignette');
photoTone('photoEdgeBoost', 'edgeBoost');
photoTone('photoAmbient', 'ambient');
photoTone('photoBlackPoint', 'blackPoint');
photoTone('photoWhitePoint', 'whitePoint');

el('photoFitSeg').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  state.photoPlacement.fit = btn.dataset.fit as PhotoFit;
  syncInputs();
  draftThenFull();
});

el('photoSeamSeg').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  state.photoPlacement.seam = btn.dataset.seam as SeamMode;
  syncInputs();
  draftThenFull();
});

el('photoAutoLevelsSeg').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  state.photoParams.autoLevels = btn.dataset.auto === '1';
  syncInputs();
  draftThenFull();
});

el('photoEdgeAwareSeg').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  state.photoParams.localContrastEdgeAware = btn.dataset.edgeaware === '1';
  syncInputs();
  draftThenFull();
});

// ---------- portrait (face) controls ----------
el('photoModeSeg').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  state.photoMode = btn.dataset.photomode as 'portrait' | 'photo';
  photoModeTouched = true;
  // switching INTO face mode should re-frame on the face, since the photo
  // pipeline's placement is a whole-image composition and the face pipeline's
  // is a crop; leaving the old one would show a face mode that looks broken
  if (state.photoMode === 'portrait') reframeOnFace();
  else if (state.photoImage) {
    state.photoPlacement = placementFor(
      state.photoImage.width, state.photoImage.height, Math.PI * state.diameterMm, state.heightMm
    );
  }
  photoCache = null;
  syncInputs();
  draftThenFull();
});

// Head size re-solves the crop, so it goes through reframeOnFace() rather than
// straight into the params.
el('portraitHead').addEventListener('input', () => {
  state.headHeightFrac = Number(el<HTMLInputElement>('portraitHead').value);
  reframeOnFace();
  photoCache = null;
  syncInputs();
  draftThenFull();
});

function portraitTone<K extends keyof PortraitParams>(id: string, key: K) {
  el(id).addEventListener('input', () => {
    state.portraitParams[key] = Number(el<HTMLInputElement>(id).value) as PortraitParams[K];
    syncInputs();
    draftThenFull();
  });
}
portraitTone('portraitBoost', 'identityBoost');
portraitTone('portraitBright', 'brightness');
portraitTone('portraitContrast', 'contrast');
portraitTone('portraitVig', 'vignette');
portraitTone('portraitLevels', 'levels');

el('portraitRecentre').addEventListener('click', () => {
  if (!reframeOnFace()) return;
  photoCache = null;
  syncInputs();
  draftThenFull();
});

el('portraitReset').addEventListener('click', () => {
  state.portraitParams = { ...DEFAULT_PORTRAIT_PARAMS };
  state.headHeightFrac = DEFAULT_HEAD_HEIGHT_FRAC;
  reframeOnFace();
  photoCache = null;
  syncInputs();
  draftThenFull();
});

el('photoInvert').addEventListener('click', () => {
  state.photoParams.invert = !state.photoParams.invert;
  syncInputs();
  draftThenFull();
});

el('photoReset').addEventListener('click', () => {
  // Look only — deliberately keeps placement, so resetting the tone controls
  // doesn't also throw away the framing the user just spent time on.
  state.photoParams = { ...DEFAULT_PHOTO_PARAMS };
  // "Reset" means back to the default FOR THIS IMAGE, and auto-Punch is part of
  // that default — handing back the generic 0.7 would reset to something the
  // image was never going to want.
  punchTouched = false;
  if (state.photoImage) {
    state.photoParams.gamma = solveAutoPunch(
      state.photoImage, Math.PI * state.diameterMm, state.heightMm,
      state.photoPlacement, state.photoParams, effectiveStipple().pitchMm
    );
  }
  syncInputs();
  draftThenFull();
});

// dot pattern
el('generatorSeg').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  state.generatorId = btn.dataset.gen!;
  generatorTouched = true;
  syncInputs();
  draftThenFull();
});

// hole mode
el('holeModeSeg').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  state.holeMode = btn.dataset.mode as HoleMode;
  delete state.overrides.mode;
  for (const b of el('holeModeSeg').querySelectorAll('button')) b.classList.toggle('active', b === btn);
  el('fixedDiameterField').style.display = state.holeMode === 'fixed' ? 'block' : 'none';
  syncInputs();
  draftThenFull();
});

// preview mode
document.querySelectorAll('button[data-preview]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.previewMode = (btn as HTMLElement).dataset.preview as PreviewMode;
    btn.parentElement!.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
    renderPreviews();
  });
});

el<HTMLInputElement>('tile2x').addEventListener('change', () => {
  state.tile2x = el<HTMLInputElement>('tile2x').checked;
  renderPreviews();
});

// which preview panes are shown — lets you work on the 3D can without
// scrolling past the flat view every time
el('viewSeg').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  state.viewMode = btn.dataset.view as ViewMode;
  applyViewMode();
  renderPreviews();
});

el<HTMLInputElement>('rotate').addEventListener('input', () => {
  state.turns = parseFloat(el<HTMLInputElement>('rotate').value);
  can3d?.setRotationDeg(state.turns * 360);
});

el<HTMLInputElement>('panY').addEventListener('input', () => {
  state.panY = parseFloat(el<HTMLInputElement>('panY').value);
  draftThenFull();
});

// --- drag the lit band directly on the flat preview to reposition the crop ---
{
  const flatCanvas = el<HTMLCanvasElement>('flatCanvas');
  let cropDrag: { startClientY: number; startPanY: number; span: number } | null = null;

  flatCanvas.addEventListener('pointerdown', (e) => {
    if (!result?.cropWindow) return;
    const span = result.designH - result.H;
    if (span <= 0) return;
    cropDrag = { startClientY: e.clientY, startPanY: state.panY, span };
    flatCanvas.setPointerCapture(e.pointerId);
  });
  flatCanvas.addEventListener('pointermove', (e) => {
    if (!cropDrag || !result) return;
    const rect = flatCanvas.getBoundingClientRect();
    const pxPerMm = (flatCanvas.height / rect.height) * FLAT_SP;
    // canvas y grows downward while design y grows upward, hence the negation
    const deltaMm = -(e.clientY - cropDrag.startClientY) / pxPerMm;
    const next = cropDrag.startPanY + deltaMm / cropDrag.span;
    state.panY = Math.min(1, Math.max(0, next));
    el<HTMLInputElement>('panY').value = String(state.panY);
    regenerate(PPM_DRAFT);
  });
  const endCropDrag = () => {
    if (!cropDrag) return;
    cropDrag = null;
    fullRegen();
  };
  flatCanvas.addEventListener('pointerup', endCropDrag);
  flatCanvas.addEventListener('pointercancel', endCropDrag);
}

// ---------- 3D can ----------
const canStyleSelect = el<HTMLSelectElement>('canStyle');
for (const style of CAN_STYLES) {
  const opt = document.createElement('option');
  opt.value = style.id;
  opt.textContent = style.name;
  canStyleSelect.appendChild(opt);
}
canStyleSelect.value = state.canStyleId;
canStyleSelect.addEventListener('change', () => {
  state.canStyleId = canStyleSelect.value;
  renderPreviews();
});

can3d = createCan3D(el('can3dMount'));
can3d.stage.addEventListener('can3d-rotate', ((e: CustomEvent<number>) => {
  state.turns = (((e.detail % 360) + 360) % 360) / 360;
  el<HTMLInputElement>('rotate').value = String(state.turns);
}) as EventListener);

// ---------- composer ----------
//
// The editor canvas draws the ACTUAL generated field rather than a hand-drawn
// schematic, so what you arrange is exactly what gets cut. Selection is drawn
// on top as outlines. (With 56 stamps in the library, maintaining a separate
// schematic per shape would drift out of sync immediately.)
const editorCanvas = el<HTMLCanvasElement>('editorCanvas');
let editorSp = 4;

function editorSize() {
  const wrap = el('editorWrap');
  const avail = Math.max(240, wrap.clientWidth || 300);
  const W = Math.PI * state.diameterMm;
  editorSp = Math.max(1.1, Math.min(6, avail / W));
  editorCanvas.width = Math.round(W * editorSp);
  editorCanvas.height = Math.round(state.heightMm * editorSp);
}

function renderEditor() {
  editorSize();
  const ctx2d = editorCanvas.getContext('2d')!;
  const W = Math.PI * state.diameterMm;
  const H = state.heightMm;
  ctx2d.fillStyle = '#0a0b0d';
  ctx2d.fillRect(0, 0, editorCanvas.width, editorCanvas.height);

  // the real field, so the editor is WYSIWYG
  if (result && result.field.length === result.Wp * result.Hp) {
    const src = document.createElement('canvas');
    src.width = result.Wp;
    src.height = result.Hp;
    const sctx = src.getContext('2d')!;
    const img = sctx.createImageData(result.Wp, result.Hp);
    for (let i = 0; i < result.field.length; i++) {
      const v = Math.round(Math.min(1, Math.max(0, result.field[i])) * 255);
      img.data[i * 4] = Math.round(v * 0.88);
      img.data[i * 4 + 1] = Math.round(v * 0.64);
      img.data[i * 4 + 2] = Math.round(v * 0.35);
      img.data[i * 4 + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    ctx2d.drawImage(src, 0, 0, editorCanvas.width, editorCanvas.height);
  }

  // First-run guidance: with nothing placed yet the canvas is just a black
  // rectangle, which reads as broken rather than as a drop target. Say what
  // it is, right where the eye lands.
  if (state.shapes.length === 0) {
    ctx2d.save();
    ctx2d.fillStyle = 'rgba(147, 154, 165, 0.55)';
    ctx2d.font = `${Math.max(11, Math.min(15, editorCanvas.height / 9))}px -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillText('Drop a shape here to begin', editorCanvas.width / 2, editorCanvas.height / 2);
    ctx2d.restore();
  }

  // selection outlines
  ctx2d.save();
  ctx2d.lineWidth = 1.5;
  ctx2d.setLineDash([5, 3]);
  for (const s of state.shapes) {
    if (!state.selectedIds.has(s.id)) continue;
    ctx2d.strokeStyle = '#ffd08a';
    const cy = (H - s.yFrac * H) * editorSp;
    if (isFullWidth(s)) {
      const h = Math.max(6, s.size * 2 * editorSp);
      ctx2d.strokeRect(1, cy - h / 2, editorCanvas.width - 2, h);
    } else {
      const cx = s.xFrac * W * editorSp;
      const r = Math.max(5, s.size * editorSp);
      ctx2d.strokeRect(cx - r, cy - r, r * 2, r * 2);
    }
  }
  ctx2d.restore();
}

function selectedShapes(): CustomShape[] {
  return state.shapes.filter((s) => state.selectedIds.has(s.id));
}

function refreshComposerUI() {
  const picked = selectedShapes();
  const propsEl = el('shapeProps');
  propsEl.style.display = picked.length ? 'block' : 'none';
  if (picked.length) {
    const first = picked[0];
    el<HTMLInputElement>('shapeSize').value = String(first.size);
    el<HTMLInputElement>('shapeRot').value = String(first.rotation);
    setText('shapeSizeVal', `${first.size.toFixed(1)} mm`);
    setText('shapeRotVal', `${first.rotation.toFixed(0)}°`);
    const rotField = el('shapeRot').closest('.field') as HTMLElement;
    rotField.style.display = picked.some(canRotate) ? 'block' : 'none';
  }

  // align/arrange need at least two shapes to mean anything
  const multi = picked.length >= 2;
  document.querySelectorAll<HTMLButtonElement>('#customPane [data-align]').forEach((b) => {
    b.disabled = !multi;
  });
  for (const [tool, min] of [
    ['distributeAround', 2],
    ['distributeVertical', 3],
    ['mirrorH', 1],
    ['mirrorV', 1],
    ['duplicate', 1],
    ['ringArray', 1],
  ] as Array<[string, number]>) {
    const b = document.querySelector<HTMLButtonElement>(`#customPane [data-tool="${tool}"]`);
    if (b) b.disabled = picked.length < min;
  }
  el<HTMLButtonElement>('deleteShape').disabled = picked.length === 0;

  // One status line carries all the just-in-time guidance that used to live in
  // a single dense hint paragraph — which message shows depends on exactly
  // what the user can do right now, so it teaches the gestures when they
  // actually apply instead of upfront. innerHTML (not setText) so <b> keeps
  // working, same as the old static hint did.
  const n = state.shapes.length;
  el('selInfo').innerHTML =
    n === 0
      ? 'No shapes yet — drag one from the palette above, or tap it to drop one in the middle.'
      : picked.length === 0
      ? `${n} shape${n === 1 ? '' : 's'} placed. Tap one to select it — <b>shift-tap</b> to select several.`
      : picked.length === 1
      ? '1 shape selected. Drag to move it, arrow keys to nudge, <b>Delete</b> to remove it.'
      : `${picked.length} of ${n} selected. Align or arrange them below, or <b>Delete</b> to remove them together.`;
}

/** Rebuild after any structural change to the shape list. */
function composerChanged() {
  refreshComposerUI();
  draftThenFull();
}

// ---------- palette ----------
function buildCategoryTabs() {
  const tabs = el('catTabs');
  tabs.innerHTML = '';
  for (const cat of SHAPE_CATEGORIES) {
    const b = document.createElement('button');
    b.textContent = cat.name;
    b.dataset.cat = cat.id;
    b.classList.toggle('active', cat.id === state.paletteCategory);
    b.addEventListener('click', () => {
      state.paletteCategory = cat.id;
      buildCategoryTabs();
      buildPalette();
    });
    tabs.appendChild(b);
  }
}

function buildPalette() {
  const pal = el('palette');
  pal.innerHTML = '';
  for (const def of shapesInCategory(state.paletteCategory)) {
    const b = document.createElement('button');
    b.textContent = def.glyph;
    b.title = `${def.name} — drag onto the canvas, or tap to place it`;
    b.dataset.shape = def.id;
    attachPaletteDrag(b, def.id);
    pal.appendChild(b);
  }
}

/** Pointer-drag a stamp from the palette onto the editor canvas. */
function attachPaletteDrag(btn: HTMLElement, shapeId: string) {
  btn.addEventListener('pointerdown', (e0) => {
    const e = e0 as PointerEvent;
    e.preventDefault();
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    document.body.appendChild(ghost);
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
    btn.classList.add('dragging');

    const move = (ev: PointerEvent) => {
      ghost.style.left = `${ev.clientX}px`;
      ghost.style.top = `${ev.clientY}px`;
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cleanup);
      btn.classList.remove('dragging');
      ghost.remove();
    };
    const up = (ev: PointerEvent) => {
      cleanup();
      const rect = editorCanvas.getBoundingClientRect();
      const inside =
        ev.clientX >= rect.left && ev.clientX <= rect.right &&
        ev.clientY >= rect.top && ev.clientY <= rect.bottom;
      // dropping anywhere outside still places it, centred — a click on the
      // palette should never feel like it did nothing
      const xf = inside ? (ev.clientX - rect.left) / rect.width : 0.5;
      const yf = inside ? 1 - (ev.clientY - rect.top) / rect.height : 0.5;
      const shape = makeShape(shapeId, ((xf % 1) + 1) % 1, Math.min(0.97, Math.max(0.03, yf)));
      state.shapes.push(shape);
      state.selectedIds = new Set([shape.id]);
      composerChanged();
      renderEditor();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cleanup);
  });
}

// ---------- canvas selection + drag ----------
function pickShapeAt(xFrac: number, yFrac: number): CustomShape | null {
  const W = Math.PI * state.diameterMm;
  const H = state.heightMm;
  let best: CustomShape | null = null;
  let bestD = Infinity;
  for (let i = state.shapes.length - 1; i >= 0; i--) {
    const s = state.shapes[i];
    if (isFullWidth(s)) {
      if (Math.abs((yFrac - s.yFrac) * H) < s.size + 2) return s;
      continue;
    }
    let dx = (xFrac - s.xFrac) * W;
    dx = (((dx + W / 2) % W) + W) % W - W / 2;
    const dy = (yFrac - s.yFrac) * H;
    const d = Math.hypot(dx, dy);
    if (d < s.size * 1.2 && d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function canvasEventToFrac(e: PointerEvent): [number, number] {
  const rect = editorCanvas.getBoundingClientRect();
  return [
    (e.clientX - rect.left) / rect.width,
    1 - (e.clientY - rect.top) / rect.height,
  ];
}

let shapeDrag: { lastX: number; lastY: number; moved: boolean } | null = null;

editorCanvas.addEventListener('pointerdown', (e) => {
  const [xf, yf] = canvasEventToFrac(e);
  const hit = pickShapeAt(xf, yf);
  if (!hit) {
    if (!e.shiftKey) state.selectedIds = new Set();
    refreshComposerUI();
    renderEditor();
    return;
  }
  if (e.shiftKey) {
    if (state.selectedIds.has(hit.id)) state.selectedIds.delete(hit.id);
    else state.selectedIds.add(hit.id);
  } else if (!state.selectedIds.has(hit.id)) {
    state.selectedIds = new Set([hit.id]);
  }
  refreshComposerUI();
  renderEditor();
  if (state.selectedIds.size) {
    shapeDrag = { lastX: xf, lastY: yf, moved: false };
    editorCanvas.setPointerCapture(e.pointerId);
  }
});

editorCanvas.addEventListener('pointermove', (e) => {
  if (!shapeDrag) return;
  const [xf, yf] = canvasEventToFrac(e);
  const dx = xf - shapeDrag.lastX;
  const dy = yf - shapeDrag.lastY;
  if (dx === 0 && dy === 0) return;
  shapeDrag.lastX = xf;
  shapeDrag.lastY = yf;
  shapeDrag.moved = true;
  // move the whole selection together
  state.shapes = nudgeShapes(state.shapes, state.selectedIds, dx, dy);
  renderEditor();
});

function endShapeDrag() {
  if (!shapeDrag) return;
  const moved = shapeDrag.moved;
  shapeDrag = null;
  if (moved) draftThenFull();
}
editorCanvas.addEventListener('pointerup', endShapeDrag);
editorCanvas.addEventListener('pointercancel', endShapeDrag);

// ---------- align / arrange tools ----------
el('customPane').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn || btn.disabled) return;

  const align = btn.dataset.align as AlignMode | undefined;
  if (align) {
    state.shapes = alignShapes(state.shapes, state.selectedIds, align);
    composerChanged();
    renderEditor();
    return;
  }

  switch (btn.dataset.tool) {
    case 'distributeAround':
      state.shapes = distributeAround(state.shapes, state.selectedIds);
      break;
    case 'distributeVertical':
      state.shapes = distributeVertical(state.shapes, state.selectedIds);
      break;
    case 'mirrorH':
      state.shapes = mirrorShapes(state.shapes, state.selectedIds, 'h');
      break;
    case 'mirrorV':
      state.shapes = mirrorShapes(state.shapes, state.selectedIds, 'v');
      break;
    case 'duplicate': {
      const r = duplicateShapes(state.shapes, state.selectedIds);
      state.shapes = r.shapes;
      if (r.newIds.length) state.selectedIds = new Set(r.newIds);
      break;
    }
    case 'ringArray': {
      const n = parseInt(el<HTMLInputElement>('ringCount').value, 10) || 6;
      const r = ringArray(state.shapes, state.selectedIds, n);
      state.shapes = r.shapes;
      break;
    }
    default:
      return;
  }
  composerChanged();
  renderEditor();
});

// ---------- per-shape properties ----------
el<HTMLInputElement>('shapeSize').addEventListener('input', () => {
  const v = parseFloat(el<HTMLInputElement>('shapeSize').value);
  if (!Number.isFinite(v)) return;
  state.shapes = state.shapes.map((s) => (state.selectedIds.has(s.id) ? { ...s, size: v } : s));
  setText('shapeSizeVal', `${v.toFixed(1)} mm`);
  renderEditor();
  draftThenFull();
});
el<HTMLInputElement>('shapeRot').addEventListener('input', () => {
  const v = parseFloat(el<HTMLInputElement>('shapeRot').value);
  if (!Number.isFinite(v)) return;
  state.shapes = state.shapes.map((s) =>
    state.selectedIds.has(s.id) && canRotate(s) ? { ...s, rotation: v } : s
  );
  setText('shapeRotVal', `${v.toFixed(0)}°`);
  renderEditor();
  draftThenFull();
});

function deleteSelected() {
  if (!state.selectedIds.size) return;
  state.shapes = state.shapes.filter((s) => !state.selectedIds.has(s.id));
  state.selectedIds = new Set();
  composerChanged();
  renderEditor();
}

el<HTMLButtonElement>('deleteShape').addEventListener('click', deleteSelected);
el<HTMLButtonElement>('clearShapes').addEventListener('click', () => {
  state.shapes = [];
  state.selectedIds = new Set();
  composerChanged();
  renderEditor();
});

// ---------- keyboard ----------
window.addEventListener('keydown', (e) => {
  if (state.sourceKind !== 'custom' || !state.selectedIds.size) return;
  const t = e.target as HTMLElement | null;
  // never hijack typing in a field
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    deleteSelected();
    return;
  }
  const step = e.shiftKey ? 0.02 : 0.004;
  let dx = 0;
  let dy = 0;
  if (e.key === 'ArrowLeft') dx = -step;
  else if (e.key === 'ArrowRight') dx = step;
  else if (e.key === 'ArrowUp') dy = step;
  else if (e.key === 'ArrowDown') dy = -step;
  else return;
  e.preventDefault();
  state.shapes = nudgeShapes(state.shapes, state.selectedIds, dx, dy);
  renderEditor();
  draftThenFull();
});

buildCategoryTabs();
buildPalette();
refreshComposerUI();

window.addEventListener('resize', debounce(() => {
  if (state.sourceKind === 'custom') renderEditor();
  renderPreviews();
}, 150));

// ---------- responsive control panels ----------
// The panels are <details> so a phone doesn't get one endless scroll wall.
// Wide layout: force every panel open, so they behave exactly like the plain
// sections they replaced (the CSS also makes their headings inert there).
// Narrow layout: only the panels marked data-mobile="open" start expanded.
{
  const stacked = window.matchMedia(STACKED_QUERY);
  const panels = document.querySelectorAll<HTMLDetailsElement>('details.ctrl');
  const applyPanelDefaults = () => {
    for (const d of panels) d.open = stacked.matches ? d.dataset.mobile === 'open' : true;
  };
  applyPanelDefaults();
  stacked.addEventListener('change', () => {
    applyPanelDefaults();
    // Crossing the breakpoint flips whether the flat pane exists at all
    // (effectiveViewMode), so the panes and the 3D can's height both need
    // recomputing — and the flat raster has to be built if it just came back.
    applyViewMode();
    // ...and the crop rail has to move back to whichever pane it annotates,
    // with the wording that matches (renderCropRail -> placeCropRail).
    renderCropRail();
    renderPreviews();
  });
}

// ---------- export ----------
el<HTMLButtonElement>('exportBtn').addEventListener('click', () => {
  if (!result) return;
  const name =
    state.sourceKind === 'photo' && state.photoName
      ? state.photoName.replace(/\.[^.]+$/, '')
      : state.sourceKind === 'preset'
      ? getPreset(state.presetId).name
      : 'my-can';
  const svg = resultToSvg(result, `${name} — ${state.diameterMm}×${state.heightMm}mm`);
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}_${state.diameterMm}x${state.heightMm}mm.svg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// ---------- init ----------
injectAnalytics(); // no-ops locally; only sends events once served from Vercel
buildGeneratorPicker();
applyViewMode();
applyAnnotationProps();
syncInputs();
regenerate(PPM_FULL);
(window as any).__state = state;
(window as any).__getResult = () => result;
(window as any).__renderEditor = renderEditor;
